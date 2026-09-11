/**
 * Core domain types.
 *
 * Design rule for this whole directory: no ambient time, no I/O, no SDK types.
 * Every function takes the instant it should reason about as an explicit
 * argument. That is what makes a 90-day history replayable in milliseconds and
 * what lets the demo compress a day into twenty minutes.
 */

/** Event kinds we normalise Ring notifications down to. */
export type ActivityKind = 'motion' | 'doorbell' | 'door_open' | 'package' | 'vehicle';

/** A single normalised activity event. */
export interface ActivityEvent {
  readonly id: string;
  readonly deviceId: string;
  /** Logical placement, e.g. 'front_door', 'hallway', 'kitchen'. */
  readonly zone: string;
  readonly kind: ActivityKind;
  /** Epoch milliseconds. */
  readonly at: number;
}

/**
 * Whether a device can currently see anything.
 *
 * This is the most important input in the system. A flat battery and an
 * unconscious person produce identical event streams: silence. Without health
 * data there is no way to tell "she has not moved" from "we cannot see her",
 * and conflating those two is the difference between a caretaking product and
 * a liability.
 */
export interface DeviceHealthSample {
  readonly deviceId: string;
  readonly zone: string;
  readonly online: boolean;
  /** Epoch milliseconds of the last telemetry we received. */
  readonly lastSeenAt: number;
  readonly batteryPercent?: number;
}

export interface HouseholdConfig {
  readonly householdId: string;
  /** IANA zone, e.g. 'Europe/London'. All routine reasoning happens in local time. */
  readonly timeZone: string;
  /**
   * Zones physically inside the home. Only interior movement (or a door
   * opening) counts as evidence that the resident is up and about — a car
   * passing the front camera does not mean your mother is awake.
   */
  readonly interiorZones: readonly string[];
  /** Local minute-of-day when the night begins, e.g. 1380 for 23:00. */
  readonly quietFromMinute: number;
  /** Local minute-of-day when the day begins, e.g. 360 for 06:00. */
  readonly quietToMinute: number;
}

/**
 * Routines differ between working days and weekends, so baselines are learned
 * separately for each. Keeping it to two classes avoids starving each bucket of
 * observations during a short onboarding window.
 */
export type DayClass = 'weekday' | 'weekend';

/** A recurring daily milestone learned from history. */
export interface Anchor {
  /** Stable identity, e.g. 'first_activity' or 'activity:kitchen:motion'. */
  readonly key: string;
  readonly label: string;
  readonly zone: string | null;
  readonly kind: ActivityKind | null;
  readonly dayClass: DayClass;
  /** Typical local minute-of-day, median across observed days. */
  readonly medianMinute: number;
  /** Median absolute deviation in minutes — robust spread. */
  readonly madMinutes: number;
  /**
   * The late end of normal: 95th percentile of observed occurrence times.
   *
   * This, not the spread, is what deadlines are built from. A household whose
   * mornings straggle gets a genuinely later deadline instead of one derived from
   * a symmetry assumption their life does not obey.
   */
  readonly lateMinute: number;
  /** Days of this class seen in the learning window. */
  readonly observedDays: number;
  /** Days of this class where the milestone actually occurred. */
  readonly presentDays: number;
  /** presentDays / observedDays. Anchors below the threshold are discarded. */
  readonly reliability: number;
}

export interface Baseline {
  readonly householdId: string;
  readonly timeZone: string;
  readonly anchors: readonly Anchor[];
  readonly daysObserved: number;
  readonly windowStart: number;
  readonly windowEnd: number;
}

export type FindingType =
  /** Expected activity is genuinely missing and the cameras were watching. */
  | 'deviation'
  /** Expected activity is missing but we could not see the zone. Never an alarm. */
  | 'unobservable';

export type Severity = 'low' | 'medium' | 'high';

export interface Finding {
  readonly type: FindingType;
  readonly anchorKey: string;
  readonly label: string;
  readonly zone: string | null;
  /** Local minute-of-day by which we expected to have seen this. */
  readonly expectedByMinute: number;
  readonly evaluatedAtMinute: number;
  readonly minutesOverdue: number;
  readonly severity: Severity;
  /** Deterministic, factual English. Safe to show a human as-is. */
  readonly reason: string;
}

export interface Assessment {
  readonly householdId: string;
  readonly evaluatedAt: number;
  readonly dateKey: string;
  readonly dayClass: DayClass;
  readonly findings: readonly Finding[];
  readonly suppressed: boolean;
  readonly suppressionReason?: string;
}

/** An explicit do-not-alert window, e.g. the resident is away for a fortnight. */
export interface SuppressionWindow {
  readonly from: number;
  readonly to: number;
  readonly reason: string;
}
