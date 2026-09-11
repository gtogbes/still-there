import { anchorsFor, deadlineMinute } from './baseline.js';
import { assessObservability, DEFAULT_OBSERVABILITY_OPTIONS } from './health.js';
import type { ObservabilityOptions } from './health.js';
import { occupancyEvents } from './occupancy.js';
import { dayClassOf, formatMinute, isQuietMinute, localParts } from './time.js';
import type {
  ActivityEvent,
  Anchor,
  Assessment,
  Baseline,
  DeviceHealthSample,
  Finding,
  HouseholdConfig,
  Severity,
  SuppressionWindow,
} from './types.js';

export interface DeviationOptions {
  /** Multiples of the habit's own variability used as a floor on the late edge. */
  readonly spreadMultiplier: number;
  /** Grace period added beyond the late edge of normal before we say anything. */
  readonly graceMinutes: number;
  readonly observability: ObservabilityOptions;
}

export const DEFAULT_DEVIATION_OPTIONS: DeviationOptions = {
  spreadMultiplier: 3,
  graceMinutes: 30,
  observability: DEFAULT_OBSERVABILITY_OPTIONS,
};

export interface AssessInput {
  readonly baseline: Baseline;
  readonly config: HouseholdConfig;
  /** Events from the local day being evaluated. Extra days are harmless but wasteful. */
  readonly todaysEvents: readonly ActivityEvent[];
  readonly health: readonly DeviceHealthSample[];
  readonly evaluatedAt: number;
  readonly suppressions?: readonly SuppressionWindow[];
  readonly options?: Partial<DeviationOptions>;
}

function severityFor(minutesOverdue: number): Severity {
  if (minutesOverdue < 60) return 'low';
  if (minutesOverdue < 180) return 'medium';
  return 'high';
}

function anchorMatches(event: ActivityEvent, anchor: Anchor): boolean {
  if (anchor.zone === null) return true;
  return event.zone === anchor.zone && event.kind === anchor.kind;
}

/**
 * Factual, deterministic English describing a finding.
 *
 * Generated here rather than by a language model on purpose. The model's job
 * later is to choose tone and decide what to lead with; it is not trusted to
 * originate claims about what the cameras saw. Every sentence below is derived
 * from data we hold, states the specific missed habit and the time it was
 * expected, and never speculates about cause — a system that turns "no motion in
 * the kitchen" into "she may have fallen" is doing real harm to the person
 * reading it at their desk.
 */
export function describeFinding(finding: Finding): string {
  return finding.reason;
}

export function assess(input: AssessInput): Assessment {
  const options: DeviationOptions = {
    ...DEFAULT_DEVIATION_OPTIONS,
    ...input.options,
    observability: { ...DEFAULT_OBSERVABILITY_OPTIONS, ...input.options?.observability },
  };

  const { config, baseline, evaluatedAt } = input;
  const { dateKey, minutesOfDay, weekday } = localParts(evaluatedAt, config.timeZone);
  const dayClass = dayClassOf(weekday);

  const suppression = (input.suppressions ?? []).find(
    (window) => evaluatedAt >= window.from && evaluatedAt <= window.to,
  );
  if (suppression !== undefined) {
    return {
      householdId: config.householdId,
      evaluatedAt,
      dateKey,
      dayClass,
      findings: [],
      suppressed: true,
      suppressionReason: suppression.reason,
    };
  }

  // Nobody is expected to be moving at 4am. Evaluating during the night window
  // would flag every sleeping household in the country.
  if (isQuietMinute(minutesOfDay, config.quietFromMinute, config.quietToMinute)) {
    return {
      householdId: config.householdId,
      evaluatedAt,
      dateKey,
      dayClass,
      findings: [],
      suppressed: true,
      suppressionReason: 'inside the household quiet hours',
    };
  }

  const seenToday = occupancyEvents(input.todaysEvents, config).filter((event) => {
    if (event.at > evaluatedAt) return false;
    return localParts(event.at, config.timeZone).dateKey === dateKey;
  });

  const findings: Finding[] = [];
  for (const anchor of anchorsFor(baseline, dayClass)) {
    const expectedBy = deadlineMinute(anchor, options.spreadMultiplier, options.graceMinutes);
    if (minutesOfDay < expectedBy) continue;

    const occurred = seenToday.some((event) => anchorMatches(event, anchor));
    if (occurred) continue;

    const minutesOverdue = Math.round(minutesOfDay - expectedBy);
    const observability = assessObservability(
      anchor.zone,
      input.health,
      evaluatedAt,
      options.observability,
    );

    if (!observability.observable) {
      findings.push({
        type: 'unobservable',
        anchorKey: anchor.key,
        label: anchor.label,
        zone: anchor.zone,
        expectedByMinute: expectedBy,
        evaluatedAtMinute: minutesOfDay,
        minutesOverdue,
        // Never escalate what we cannot see. A blind spot is a maintenance job,
        // not a welfare emergency, and dressing it up as one is how families
        // learn to ignore the alerts that matter.
        severity: 'low',
        reason: `Cannot confirm ${anchor.label} today: ${observability.blindReason ?? 'the zone is not observable'}. Expected by ${formatMinute(expectedBy)}, now ${formatMinute(minutesOfDay)}.`,
      });
      continue;
    }

    findings.push({
      type: 'deviation',
      anchorKey: anchor.key,
      label: anchor.label,
      zone: anchor.zone,
      expectedByMinute: expectedBy,
      evaluatedAtMinute: minutesOfDay,
      minutesOverdue,
      severity: severityFor(minutesOverdue),
      reason: `No ${anchor.label} yet today. Usually by ${formatMinute(anchor.medianMinute)} (allowing until ${formatMinute(expectedBy)}), seen on ${anchor.presentDays} of the last ${anchor.observedDays} ${dayClass === 'weekday' ? 'working days' : 'weekend days'}. It is now ${formatMinute(minutesOfDay)}, ${minutesOverdue} minutes past.`,
    });
  }

  findings.sort((a, b) => b.minutesOverdue - a.minutesOverdue);

  return {
    householdId: config.householdId,
    evaluatedAt,
    dateKey,
    dayClass,
    findings,
    suppressed: false,
  };
}

/** Findings that represent genuinely missing activity we were able to watch for. */
export function deviations(assessment: Assessment): readonly Finding[] {
  return assessment.findings.filter((finding) => finding.type === 'deviation');
}

/** Findings caused by our own blind spots. These route to maintenance, not to family. */
export function blindSpots(assessment: Assessment): readonly Finding[] {
  return assessment.findings.filter((finding) => finding.type === 'unobservable');
}

/** Highest severity among real deviations, or null when there is nothing to say. */
export function peakSeverity(assessment: Assessment): Severity | null {
  const order: readonly Severity[] = ['low', 'medium', 'high'];
  let peak: Severity | null = null;
  for (const finding of deviations(assessment)) {
    if (peak === null || order.indexOf(finding.severity) > order.indexOf(peak)) {
      peak = finding.severity;
    }
  }
  return peak;
}
