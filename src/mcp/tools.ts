import { learnBaseline } from '../domain/baseline.js';
import { assess, blindSpots, deviations, peakSeverity } from '../domain/deviation.js';
import { addDays, formatMinute, fromLocal, localParts } from '../domain/time.js';
import type { ActivityEvent, Assessment, DeviceHealthSample, SuppressionWindow } from '../domain/types.js';
import type { StoredHousehold } from '../storage/household.js';

/**
 * The four questions StillThere can answer, as pure functions.
 *
 * Separated from both the MCP transport and from DynamoDB so they can be tested
 * without either. Everything here takes its data as an argument, including the
 * current instant — same discipline as the domain layer, for the same reason.
 *
 * These are written to be *spoken*. A caregiver asking "is Mum up yet?" at a kitchen
 * counter is not reading a dashboard: no tables, no identifiers, no minute counts.
 * Times are given as a human would say them.
 */

export interface StatusInput {
  readonly household: StoredHousehold;
  readonly historyEvents: readonly ActivityEvent[];
  readonly todaysEvents: readonly ActivityEvent[];
  readonly health: readonly DeviceHealthSample[];
  readonly evaluatedAt: number;
}

/** Spoken-language time. "half seven" beats "07:31" out loud. */
function spoken(minuteOfDay: number): string {
  return formatMinute(minuteOfDay);
}

function describeLateness(minutes: number): string {
  if (minutes < 60) return `about ${minutes} minutes later than usual`;
  const hours = Math.round((minutes / 60) * 2) / 2;
  const unit = hours === 1 ? 'hour' : 'hours';
  return `about ${hours} ${unit} later than usual`;
}

/**
 * "Is she up yet?"
 *
 * The answer people actually want, with the reasoning available but not leading.
 * Note that an unobservable finding gets its own answer rather than being folded in
 * with the reassuring case — "everything looks normal" would be a lie when the truth
 * is that nothing has been watching.
 */
export function householdStatus(input: StatusInput): { text: string; assessment: Assessment } {
  const { household, evaluatedAt } = input;
  const baseline = learnBaseline(input.historyEvents, household);
  const assessment = assess({
    baseline,
    config: household,
    todaysEvents: input.todaysEvents,
    health: input.health,
    evaluatedAt,
    suppressions: household.suppressions,
  });

  const who = household.residentName ?? 'she';
  const found = deviations(assessment);
  const blind = blindSpots(assessment);
  const now = spoken(localParts(evaluatedAt, household.timeZone).minutesOfDay);

  if (assessment.suppressed) {
    const why = assessment.suppressionReason ?? 'monitoring is paused';
    return {
      text: `Nothing to report — ${why}.`,
      assessment,
    };
  }

  if (baseline.anchors.length === 0) {
    return {
      text:
        `I don't know ${who}'s routine well enough yet to say. ` +
        `I need a couple of weeks of ordinary days before I can tell a late morning from a normal one.`,
      assessment,
    };
  }

  if (found.length === 0 && blind.length === 0) {
    const seen = input.todaysEvents.length;
    return {
      text:
        seen === 0
          ? `Nothing out of the ordinary so far today, and nothing is overdue yet. It's ${now}.`
          : `${who === 'she' ? 'She' : who} seems to be having a normal day. Nothing is overdue. It's ${now}.`,
      assessment,
    };
  }

  if (found.length === 0 && blind.length > 0) {
    // Deliberately not reassuring. We cannot see, and saying "all normal" here would
    // be the most misleading thing this tool could do.
    return {
      text:
        `I can't actually tell you. ${blind[0]?.reason ?? 'The cameras are not reporting.'} ` +
        `That's worth sorting out, but it isn't a reason to worry about ${who}.`,
      assessment,
    };
  }

  const worst = [...found].sort((a, b) => b.minutesOverdue - a.minutesOverdue)[0];
  if (worst === undefined) return { text: 'Nothing to report.', assessment };

  const lead =
    `No sign of ${who === 'she' ? 'her' : who} ${worst.label.startsWith('first') ? 'being up' : worst.label} yet today. ` +
    `Usually by ${spoken(worst.medianMinute)}, and it's ${now} — ` +
    `${describeLateness(worst.minutesOverdue)}.`;

  const others =
    found.length > 1
      ? ` ${found.length - 1} other usual thing${found.length === 2 ? '' : 's'} also outstanding.`
      : '';

  const confidence = ` That habit held on ${worst.presentDays} of the last ${worst.observedDays} comparable days.`;

  return { text: lead + others + confidence, assessment };
}

/**
 * "Why did you message me?"
 *
 * The question that justifies keeping an assessment audit trail, and the one a
 * monitoring product usually cannot answer. Every stored finding carries the habit,
 * the time it was expected and how dependable it had been, so the explanation is
 * recalled rather than reconstructed.
 */
export function explainAssessment(
  assessment: Assessment | undefined,
  timeZone: string,
): string {
  if (assessment === undefined) {
    return "I haven't sent you anything recently, so there's nothing to explain.";
  }

  const found = assessment.findings.filter((f) => f.type === 'deviation');
  if (found.length === 0) {
    return "The last time I looked, nothing was out of the ordinary, so I didn't contact you.";
  }

  const when = localParts(assessment.evaluatedAt, timeZone);
  const parts = found
    .slice(0, 3)
    .map(
      (f) =>
        `${f.label}, expected by ${spoken(f.expectedByMinute)} and ${f.minutesOverdue} minutes overdue at that point`,
    );

  return (
    `At ${spoken(when.minutesOfDay)} on ${when.dateKey} I found ${found.length} usual ` +
    `thing${found.length === 1 ? '' : 's'} hadn't happened: ${parts.join('; ')}. ` +
    `I only raise something once it's later than this household's own normal range, not on a fixed schedule.`
  );
}

/**
 * "What does a normal day look like for her?"
 *
 * Worth exposing because it is the part people do not expect a monitor to know. It
 * also lets a family sanity-check what the system believes, which is the only way
 * they can catch it having learned something wrong.
 */
export function describeRoutine(
  household: StoredHousehold,
  historyEvents: readonly ActivityEvent[],
): string {
  const baseline = learnBaseline(historyEvents, household);
  const who = household.residentName ?? 'She';

  if (baseline.anchors.length === 0) {
    return `I haven't learned ${who === 'She' ? 'her' : `${who}'s`} routine yet. I need a couple of weeks of ordinary days first.`;
  }

  const weekday = baseline.anchors
    .filter((a) => a.dayClass === 'weekday')
    .sort((a, b) => a.medianMinute - b.medianMinute);

  if (weekday.length === 0) {
    return `I've only learned ${who === 'She' ? 'her' : `${who}'s`} weekend pattern so far.`;
  }

  const described = weekday.map((a) => `${a.label} around ${spoken(a.medianMinute)}`);
  const last = described.pop();

  return (
    `On a working day, ${who === 'She' ? 'she' : who} usually has ${described.join(', ')}${described.length > 0 ? ', and ' : ''}${last}. ` +
    `That's learned from ${baseline.daysObserved} days, not set by anyone. ` +
    `I only watch for habits that hold on more than nineteen days in twenty — anything less reliable than that isn't a habit, and alerting on it would just be noise.`
  );
}

/**
 * "She's away this week, stop watching."
 *
 * The one tool that writes. Without it the system would cry wolf for the whole of a
 * fortnight's holiday, which is the fastest way to get a monitoring product muted
 * permanently.
 */
export function buildSuppression(
  fromAt: number,
  days: number,
  reason: string,
): SuppressionWindow {
  const clamped = Math.max(1, Math.min(days, 90));
  return {
    from: fromAt,
    to: fromAt + clamped * 86_400_000,
    reason: reason.trim() === '' ? 'away' : reason.trim(),
  };
}

export function describeSuppression(window: SuppressionWindow, timeZone: string): string {
  const until = localParts(window.to, timeZone);
  return (
    `Right. I'll stop watching until ${until.dateKey} — reason noted as "${window.reason}". ` +
    `I'll keep recording activity in the background, so the routine won't be forgotten, ` +
    `and I just won't raise anything until then.`
  );
}

/** The learning window an assessment reads. Exposed so the handler and tools agree. */
export const BASELINE_DAYS = 42;

export function baselineWindow(
  evaluatedAt: number,
  timeZone: string,
): { learnFrom: number; dayStart: number; dayEnd: number } {
  const { dateKey } = localParts(evaluatedAt, timeZone);
  const dayStart = fromLocal(dateKey, 0, timeZone);
  return {
    learnFrom: fromLocal(addDays(dateKey, -BASELINE_DAYS), 0, timeZone),
    dayStart,
    dayEnd: dayStart + 86_400_000,
  };
}
