export type {
  ActivityEvent,
  ActivityKind,
  Anchor,
  Assessment,
  Baseline,
  DayClass,
  DeviceHealthSample,
  Finding,
  FindingType,
  HouseholdConfig,
  Severity,
  SuppressionWindow,
} from './domain/types.js';

export { anchorsFor, deadlineMinute, describeAnchor, learnBaseline, DEFAULT_LEARN_OPTIONS } from './domain/baseline.js';
export type { LearnOptions } from './domain/baseline.js';

export {
  assess,
  blindSpots,
  describeFinding,
  deviations,
  peakSeverity,
  DEFAULT_DEVIATION_OPTIONS,
} from './domain/deviation.js';
export type { AssessInput, DeviationOptions } from './domain/deviation.js';

export { assessObservability, DEFAULT_OBSERVABILITY_OPTIONS } from './domain/health.js';
export type { ObservabilityOptions, ObservabilityVerdict } from './domain/health.js';

export { isOccupancyEvidence, occupancyEvents, groupByLocalDate } from './domain/occupancy.js';

export { fixedClock, manualClock, scaledClock, systemClock } from './domain/clock.js';
export type { Clock } from './domain/clock.js';

export {
  addDays,
  dayClassOf,
  formatMinute,
  fromLocal,
  isQuietMinute,
  localParts,
  weekdayOf,
} from './domain/time.js';
