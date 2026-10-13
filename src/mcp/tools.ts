import { anchorsFor, deadlineMinute, learnBaseline } from '../domain/baseline.js';
import {
  assess,
  blindSpots,
  DEFAULT_DEVIATION_OPTIONS,
  deviations,
  peakSeverity,
} from '../domain/deviation.js';
import { isOccupancyEvidence, occupancyEvents } from '../domain/occupancy.js';
import { addDays, dayClassOf, formatMinute, fromLocal, isQuietMinute, localParts } from '../domain/time.js';
import type {
  ActivityEvent,
  Anchor,
  Assessment,
  DeviceHealthSample,
  Severity,
  SuppressionWindow,
} from '../domain/types.js';
import type { StoredAssessment } from '../storage/assessments.js';
import type { StoredHousehold } from '../storage/household.js';

/**
 * The questions StillThere can answer, as pure functions.
 *
 * Separated from both the MCP transport and DynamoDB so they can be tested without
 * either. Everything takes its data as an argument, including the current instant.
 *
 * Each answer has two halves, and they are for different audiences:
 *
 *   text  — written to be spoken. A caregiver asking "is Mum up yet?" at a kitchen
 *           counter wants a sentence, not a table.
 *   data  — structured, for a screen. An Echo Show draws the day as a timeline,
 *           which no sentence can do. Returned as MCP structuredContent.
 *
 * Neither half ever contains a device identifier, an image, or a raw event. The
 * questions are about a person.
 */

// ── Shared shapes ───────────────────────────────────────────────────────────

export type HabitState = 'done' | 'overdue' | 'waiting' | 'cannot_see';

export interface HabitToday {
  readonly key: string;
  /** Short, for a screen: "Up and about", "Kitchen". */
  readonly name: string;
  /** Long, for speech: "activity in the kitchen". */
  readonly label: string;
  readonly usualMinute: number;
  readonly deadlineMinute: number;
  /** When it happened today, if it did. */
  readonly happenedAtMinute: number | null;
  readonly state: HabitState;
  readonly presentDays: number;
  readonly observedDays: number;
}

export type StatusState = 'normal' | 'overdue' | 'cannot_see' | 'paused' | 'night' | 'learning';

export interface StatusData {
  readonly kind: 'status';
  readonly state: StatusState;
  readonly severity: Severity | null;
  readonly residentName: string | null;
  readonly dateKey: string;
  readonly nowMinute: number;
  readonly headline: string;
  readonly detail: string;
  readonly habits: readonly HabitToday[];
  /** Minutes of the day at which a person was seen moving indoors. */
  readonly activityMinutes: readonly number[];
  /** Movement deliberately not counted, so the screen can say so. */
  readonly ignored: { readonly notAPerson: number; readonly outside: number };
  readonly pausedUntil: string | null;
  readonly pauseReason: string | null;
}

export interface RoutineData {
  readonly kind: 'routine';
  readonly residentName: string | null;
  readonly daysObserved: number;
  readonly weekday: readonly RoutineHabit[];
  readonly weekend: readonly RoutineHabit[];
}

export interface RoutineHabit {
  readonly key: string;
  readonly name: string;
  readonly label: string;
  readonly usualMinute: number;
  readonly latestNormalMinute: number;
  readonly reliability: number;
  readonly presentDays: number;
  readonly observedDays: number;
}

export interface ExplainData {
  readonly kind: 'explanation';
  readonly found: boolean;
  readonly dateKey: string | null;
  readonly sentAtMinute: number | null;
  readonly severity: Severity | null;
  /** The exact words the family received. */
  readonly message: string | null;
  readonly phrasedBy: 'bedrock' | 'deterministic' | null;
  readonly findings: readonly {
    readonly name: string;
    readonly label: string;
    readonly usualMinute: number;
    readonly expectedByMinute: number;
    readonly minutesOverdue: number;
    readonly presentDays: number;
    readonly observedDays: number;
  }[];
}

export interface PauseData {
  readonly kind: 'paused';
  readonly untilDateKey: string;
  readonly reason: string;
  readonly days: number;
}

export interface ResumeData {
  readonly kind: 'resumed';
  readonly wasPaused: boolean;
}

export interface ToolAnswer<T> {
  readonly text: string;
  readonly data: T;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function hhmm(minuteOfDay: number): string {
  return formatMinute(minuteOfDay);
}

function describeLateness(minutes: number): string {
  if (minutes < 60) return `about ${minutes} minutes later than usual`;
  const hours = Math.round((minutes / 60) * 2) / 2;
  return `about ${hours} ${hours === 1 ? 'hour' : 'hours'} later than usual`;
}

function titleCase(value: string): string {
  return value
    .split(/[_\s]+/)
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** "Up and about", "Hallway", "Front door". What fits under a dot on a timeline. */
export function shortName(anchor: Pick<Anchor, 'key' | 'zone'>): string {
  if (anchor.key === 'first_activity') return 'Up and about';
  return anchor.zone === null ? 'Activity' : titleCase(anchor.zone);
}

function anchorMatches(event: ActivityEvent, anchor: Anchor): boolean {
  if (anchor.zone === null) return true;
  return event.zone === anchor.zone && event.kind === anchor.kind;
}

function deadlineFor(anchor: Anchor): number {
  return deadlineMinute(
    anchor,
    DEFAULT_DEVIATION_OPTIONS.spreadMultiplier,
    DEFAULT_DEVIATION_OPTIONS.graceMinutes,
  );
}

function activeSuppression(household: StoredHousehold, at: number): SuppressionWindow | undefined {
  return household.suppressions.find((w) => at >= w.from && at <= w.to);
}

// ── still_there_status ──────────────────────────────────────────────────────

export interface StatusInput {
  readonly household: StoredHousehold;
  readonly historyEvents: readonly ActivityEvent[];
  readonly todaysEvents: readonly ActivityEvent[];
  readonly health: readonly DeviceHealthSample[];
  readonly evaluatedAt: number;
}

/**
 * "Is she up yet?"
 *
 * An unobservable finding gets its own answer rather than being folded in with the
 * reassuring case. "Everything looks normal" would be a lie when the truth is that
 * nothing has been watching.
 */
export function householdStatus(
  input: StatusInput,
): ToolAnswer<StatusData> & { readonly assessment: Assessment } {
  const { household, evaluatedAt } = input;
  const tz = household.timeZone;
  const baseline = learnBaseline(input.historyEvents, household);
  const assessment = assess({
    baseline,
    config: household,
    todaysEvents: input.todaysEvents,
    health: input.health,
    evaluatedAt,
    suppressions: household.suppressions,
  });

  const { dateKey, minutesOfDay, weekday } = localParts(evaluatedAt, tz);
  const name = household.residentName ?? null;
  const subject = name ?? 'her';
  const Subject = name ?? 'She';

  const found = deviations(assessment);
  const blind = blindSpots(assessment);
  const severity = peakSeverity(assessment);

  // Today, up to now, with the reasons each event did or did not count.
  const seenSoFar = input.todaysEvents.filter(
    (e) => e.at <= evaluatedAt && localParts(e.at, tz).dateKey === dateKey,
  );
  const evidence = occupancyEvents(seenSoFar, household);
  const ignored = {
    notAPerson: seenSoFar.filter(
      (e) =>
        e.kind === 'motion' &&
        household.interiorZones.includes(e.zone) &&
        !isOccupancyEvidence(e, household),
    ).length,
    outside: seenSoFar.filter(
      (e) => e.kind !== 'door_open' && !household.interiorZones.includes(e.zone),
    ).length,
  };

  const overdueKeys = new Set(found.map((f) => f.anchorKey));
  const blindKeys = new Set(blind.map((f) => f.anchorKey));

  const habits: HabitToday[] = anchorsFor(baseline, dayClassOf(weekday))
    .map((anchor) => {
      const first = evidence.find((e) => anchorMatches(e, anchor));
      const happenedAtMinute = first === undefined ? null : localParts(first.at, tz).minutesOfDay;
      const state: HabitState =
        happenedAtMinute !== null
          ? 'done'
          : overdueKeys.has(anchor.key)
            ? 'overdue'
            : blindKeys.has(anchor.key)
              ? 'cannot_see'
              : 'waiting';
      return {
        key: anchor.key,
        name: shortName(anchor),
        label: anchor.label,
        usualMinute: anchor.medianMinute,
        deadlineMinute: deadlineFor(anchor),
        happenedAtMinute,
        state,
        presentDays: anchor.presentDays,
        observedDays: anchor.observedDays,
      };
    })
    .sort((a, b) => a.usualMinute - b.usualMinute);

  const base = {
    kind: 'status' as const,
    severity,
    residentName: name,
    dateKey,
    nowMinute: minutesOfDay,
    habits,
    activityMinutes: evidence.map((e) => localParts(e.at, tz).minutesOfDay),
    ignored,
    pausedUntil: null,
    pauseReason: null,
  };

  const answer = (
    state: StatusState,
    headline: string,
    detail: string,
    extra: Partial<StatusData> = {},
  ) => ({
    text: `${headline} ${detail}`.trim(),
    data: { ...base, state, headline, detail, ...extra },
    assessment,
  });

  const pause = activeSuppression(household, evaluatedAt);
  if (pause !== undefined) {
    const until = localParts(pause.to, tz).dateKey;
    return answer(
      'paused',
      `Monitoring is paused until ${until}.`,
      `Reason given: ${pause.reason}. I'm still keeping a record so the routine isn't forgotten.`,
      { pausedUntil: until, pauseReason: pause.reason },
    );
  }

  if (isQuietMinute(minutesOfDay, household.quietFromMinute, household.quietToMinute)) {
    return answer(
      'night',
      `It's still night-time at ${Subject === 'She' ? 'her' : `${Subject}'s`} home.`,
      `I don't watch for anything until ${hhmm(household.quietToMinute)}.`,
    );
  }

  if (baseline.anchors.length === 0) {
    return answer(
      'learning',
      `I don't know ${name === null ? 'her' : `${name}'s`} routine well enough yet to say.`,
      `I need a couple of weeks of ordinary days before I can tell a late morning from a normal one.`,
    );
  }

  if (found.length === 0 && blind.length > 0) {
    // Deliberately not reassuring. We cannot see, and saying "all normal" here
    // would be the most misleading thing this tool could do.
    return answer(
      'cannot_see',
      `I can't actually tell you.`,
      `${blind[0]?.reason ?? 'The cameras are not reporting.'} That's worth sorting out, but it isn't a reason to worry about ${subject}.`,
    );
  }

  if (found.length === 0) {
    const done = habits.filter((h) => h.state === 'done').length;
    return answer(
      'normal',
      done > 0
        ? `${Subject} seems to be having a normal day.`
        : `Nothing out of the ordinary so far today.`,
      `Nothing is overdue. It's ${hhmm(minutesOfDay)}.`,
    );
  }

  // If she hasn't been seen at all, that is the news — lead with it even when some
  // narrower habit (the hallway, say) happens to be a few minutes more overdue.
  // "No activity in the hallway" on a morning nobody got up buries the headline.
  const worst =
    found.find((f) => f.anchorKey === 'first_activity') ??
    [...found].sort((a, b) => b.minutesOverdue - a.minutesOverdue)[0];
  if (worst === undefined) return answer('normal', 'Nothing to report.', '');

  const headline =
    worst.anchorKey === 'first_activity'
      ? `No sign of ${subject} being up yet today.`
      : `No ${worst.label} yet today.`;

  const others =
    found.length > 1
      ? ` ${found.length - 1} other usual thing${found.length === 2 ? ' is' : 's are'} also outstanding.`
      : '';

  const detail =
    `Usually by ${hhmm(worst.medianMinute)}, and it's ${hhmm(minutesOfDay)} — ` +
    `${describeLateness(worst.minutesOverdue)}.${others} ` +
    `That habit held on ${worst.presentDays} of the last ${worst.observedDays} comparable days.`;

  return answer('overdue', headline, detail);
}

// ── explain_last_alert ──────────────────────────────────────────────────────

/**
 * "Why did you message me?"
 *
 * The question that justifies keeping an assessment audit trail, and one a
 * monitoring product usually cannot answer — the reasoning existed only as long as
 * the alert took to send. Here the assessment is stored with the exact message and
 * the findings behind it, so the explanation is recalled rather than reconstructed.
 */
export function explainAssessment(
  stored: StoredAssessment | undefined,
  timeZone: string,
): ToolAnswer<ExplainData> {
  const empty: ExplainData = {
    kind: 'explanation',
    found: false,
    dateKey: null,
    sentAtMinute: null,
    severity: null,
    message: null,
    phrasedBy: null,
    findings: [],
  };

  if (stored === undefined) {
    return { text: "I haven't sent you anything recently, so there's nothing to explain.", data: empty };
  }

  const found = stored.findings.filter((f) => f.type === 'deviation');
  if (found.length === 0) {
    return {
      text: "The last time I looked, nothing was out of the ordinary, so I didn't contact you.",
      data: empty,
    };
  }

  const when = localParts(stored.evaluatedAt, timeZone);
  const ordered = [...found].sort((a, b) => b.minutesOverdue - a.minutesOverdue);
  const parts = ordered
    .slice(0, 3)
    .map(
      (f) =>
        `${f.label}, which usually happens by ${hhmm(f.medianMinute)} and was ${f.minutesOverdue} minutes overdue`,
    );

  const text =
    `At ${hhmm(when.minutesOfDay)} I found ${found.length} usual ` +
    `thing${found.length === 1 ? '' : 's'} hadn't happened: ${parts.join('; ')}. ` +
    `I only raise something once it's later than this household's own normal range, not on a fixed schedule.`;

  return {
    text,
    data: {
      kind: 'explanation',
      found: true,
      dateKey: when.dateKey,
      sentAtMinute: when.minutesOfDay,
      severity: stored.notification?.severity ?? null,
      message: stored.notification?.text ?? null,
      phrasedBy:
        stored.notification === undefined
          ? null
          : stored.notification.source === 'model'
            ? 'bedrock'
            : 'deterministic',
      findings: ordered.map((f) => ({
        name: shortName({ key: f.anchorKey, zone: f.zone }),
        label: f.label,
        usualMinute: f.medianMinute,
        expectedByMinute: f.expectedByMinute,
        minutesOverdue: f.minutesOverdue,
        presentDays: f.presentDays,
        observedDays: f.observedDays,
      })),
    },
  };
}

// ── describe_routine ────────────────────────────────────────────────────────

/**
 * "What does a normal day look like for her?"
 *
 * The part people do not expect a monitor to know. It also lets a family check what
 * the system believes, which is the only way they can catch it having learned
 * something wrong.
 */
export function describeRoutine(
  household: StoredHousehold,
  historyEvents: readonly ActivityEvent[],
): ToolAnswer<RoutineData> {
  const baseline = learnBaseline(historyEvents, household);
  const name = household.residentName ?? null;

  const toHabit = (a: Anchor): RoutineHabit => ({
    key: a.key,
    name: shortName(a),
    label: a.label,
    usualMinute: a.medianMinute,
    latestNormalMinute: a.lateMinute,
    reliability: a.reliability,
    presentDays: a.presentDays,
    observedDays: a.observedDays,
  });

  const weekday = anchorsFor(baseline, 'weekday')
    .map(toHabit)
    .sort((a, b) => a.usualMinute - b.usualMinute);
  const weekend = anchorsFor(baseline, 'weekend')
    .map(toHabit)
    .sort((a, b) => a.usualMinute - b.usualMinute);

  const data: RoutineData = {
    kind: 'routine',
    residentName: name,
    daysObserved: baseline.daysObserved,
    weekday,
    weekend,
  };

  if (baseline.anchors.length === 0) {
    return {
      text: `I haven't learned ${name === null ? 'her' : `${name}'s`} routine yet. I need a couple of weeks of ordinary days first.`,
      data,
    };
  }

  if (weekday.length === 0) {
    return {
      text: `I've only learned ${name === null ? 'her' : `${name}'s`} weekend pattern so far.`,
      data,
    };
  }

  const described = weekday.map((h) => `${h.label} around ${hhmm(h.usualMinute)}`);
  const last = described.pop();

  return {
    text:
      `On a working day, ${name ?? 'she'} usually has ${described.join(', ')}${described.length > 0 ? ', and ' : ''}${last}. ` +
      `That's learned from ${baseline.daysObserved} days, not set by anyone. ` +
      `I only watch for habits that hold on more than nineteen days in twenty — anything less reliable than that isn't a habit, and alerting on it would just be noise.`,
    data,
  };
}

// ── pause_monitoring / resume_monitoring ───────────────────────────────────

/**
 * "She's away this week, stop watching."
 *
 * Without it the system would cry wolf through a whole holiday, which is the fastest
 * way to get a monitoring product muted for good.
 */
export function buildSuppression(fromAt: number, days: number, reason: string): SuppressionWindow {
  // Clamped because a voice interface will occasionally hear "three hundred days",
  // and pausing a welfare monitor for a year on a mis-hear is not acceptable.
  const clamped = Math.max(1, Math.min(Math.round(days), 90));
  return {
    from: fromAt,
    to: fromAt + clamped * 86_400_000,
    reason: reason.trim() === '' ? 'away' : reason.trim(),
  };
}

export function describeSuppression(
  window: SuppressionWindow,
  timeZone: string,
): ToolAnswer<PauseData> {
  const until = localParts(window.to, timeZone).dateKey;
  return {
    text:
      `Right. I'll stop watching until ${until} — reason noted as "${window.reason}". ` +
      `I'll keep recording activity in the background, so the routine won't be forgotten, ` +
      `and I just won't raise anything until then.`,
    data: {
      kind: 'paused',
      untilDateKey: until,
      reason: window.reason,
      days: Math.round((window.to - window.from) / 86_400_000),
    },
  };
}

/** "She's back." Ends every active pause from this moment. */
export function endSuppressions(
  suppressions: readonly SuppressionWindow[],
  at: number,
): { readonly remaining: SuppressionWindow[]; readonly answer: ToolAnswer<ResumeData> } {
  const wasPaused = suppressions.some((w) => at >= w.from && at <= w.to);
  // Future windows survive: "she's back" today says nothing about next month's trip.
  const remaining = suppressions.filter((w) => w.from > at);
  return {
    remaining,
    answer: {
      text: wasPaused
        ? "Welcome back. I'm watching again from now."
        : "Monitoring wasn't paused, so nothing has changed — I'm already watching.",
      data: { kind: 'resumed', wasPaused },
    },
  };
}

// ── Windows ─────────────────────────────────────────────────────────────────

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
