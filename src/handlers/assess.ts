import { learnBaseline } from '../domain/baseline.js';
import { assess, blindSpots, deviations, peakSeverity } from '../domain/deviation.js';
import { addDays, fromLocal, localParts } from '../domain/time.js';
import { eventsBetween } from '../storage/events.js';
import { getHousehold } from '../storage/household.js';
import { deviceHealthFor } from '../storage/state.js';
import { putAssessment } from '../storage/assessments.js';
import { tableNames } from '../storage/tables.js';

/**
 * Scheduled assessment.
 *
 * Runs on a timer rather than on the webhook path, and that split is the whole
 * reason the ingest handler can answer Ring inside its five-second budget. It also
 * means the thing that matters — noticing an absence — does not depend on an event
 * arriving, which is just as well, because an absence is precisely the case where
 * no event arrives.
 *
 * This is the first place that reads the clock for real. Everything below it takes
 * `evaluatedAt` as an argument, which is what let the reasoning be tested against
 * ninety synthetic days without waiting ninety days.
 */

/** How much history to learn from. Six weeks covers both day classes comfortably. */
const BASELINE_DAYS = 42;

interface ScheduledEvent {
  /** Optional override, for replaying a specific moment during a demo or a test. */
  readonly evaluatedAt?: number;
  readonly householdId?: string;
}

export async function handler(event: ScheduledEvent = {}): Promise<{
  readonly householdId: string;
  readonly evaluatedAt: number;
  readonly deviations: number;
  readonly blindSpots: number;
  readonly severity: string | null;
  readonly suppressed: boolean;
}> {
  const tables = tableNames(process.env);
  const householdId = event.householdId ?? process.env['HOUSEHOLD_ID'];
  if (householdId === undefined) throw new Error('HOUSEHOLD_ID must be set');

  const evaluatedAt = event.evaluatedAt ?? Date.now();

  const household = await getHousehold(tables, householdId);
  if (household === undefined) {
    // Not an error. A deployment with no household configured yet is a normal
    // intermediate state, and throwing here would fill the logs with noise that
    // looks like a fault.
    console.log('no household configured, nothing to assess', { householdId });
    return {
      householdId,
      evaluatedAt,
      deviations: 0,
      blindSpots: 0,
      severity: null,
      suppressed: true,
    };
  }

  const { dateKey } = localParts(evaluatedAt, household.timeZone);
  const dayStart = fromLocal(dateKey, 0, household.timeZone);
  const learnFrom = fromLocal(addDays(dateKey, -BASELINE_DAYS), 0, household.timeZone);

  // Read the learning window and today separately. The baseline must not include
  // today, or a missing morning becomes part of what counts as normal — the system
  // would learn to expect the very absence it is supposed to report.
  const [history, todaysEvents, health] = await Promise.all([
    eventsBetween(tables, householdId, learnFrom, dayStart),
    eventsBetween(tables, householdId, dayStart, dayStart + 86_400_000),
    deviceHealthFor(tables, householdId),
  ]);

  const baseline = learnBaseline(history, household);

  const assessment = assess({
    baseline,
    config: household,
    todaysEvents,
    health,
    evaluatedAt,
    suppressions: household.suppressions,
  });

  const found = deviations(assessment);
  const blind = blindSpots(assessment);
  const severity = peakSeverity(assessment);

  await putAssessment(tables, assessment, {
    anchorCount: baseline.anchors.length,
    historyDays: baseline.daysObserved,
    eventsToday: todaysEvents.length,
  });

  // Structured so it can be queried in CloudWatch Logs Insights, and so the
  // reasoning is recoverable after the fact. Findings carry their own explanation
  // by design, which makes the log the audit trail for why a family was contacted.
  console.log(
    JSON.stringify({
      message: 'assessment complete',
      householdId,
      dateKey,
      evaluatedAt,
      anchors: baseline.anchors.length,
      historyDays: baseline.daysObserved,
      eventsToday: todaysEvents.length,
      suppressed: assessment.suppressed,
      suppressionReason: assessment.suppressionReason,
      deviations: found.map((f) => ({
        anchor: f.anchorKey,
        severity: f.severity,
        minutesOverdue: f.minutesOverdue,
        reason: f.reason,
      })),
      blindSpots: blind.map((f) => ({ anchor: f.anchorKey, reason: f.reason })),
    }),
  );

  // Emitted in the Embedded Metric Format so CloudWatch turns these into real
  // metrics without a PutMetricData call. Worth having from the start: the
  // false-positive rate we measured in tests is only a claim until it is observed
  // against a live household.
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: evaluatedAt,
        CloudWatchMetrics: [
          {
            Namespace: 'StillThere',
            Dimensions: [['householdId']],
            Metrics: [
              { Name: 'Deviations', Unit: 'Count' },
              { Name: 'BlindSpots', Unit: 'Count' },
              { Name: 'AnchorsLearned', Unit: 'Count' },
              { Name: 'EventsToday', Unit: 'Count' },
            ],
          },
        ],
      },
      householdId,
      Deviations: found.length,
      BlindSpots: blind.length,
      AnchorsLearned: baseline.anchors.length,
      EventsToday: todaysEvents.length,
    }),
  );

  return {
    householdId,
    evaluatedAt,
    deviations: found.length,
    blindSpots: blind.length,
    severity,
    suppressed: assessment.suppressed,
  };
}
