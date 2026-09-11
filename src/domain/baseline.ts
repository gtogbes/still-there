import { median, medianAbsoluteDeviation, quantile } from './stats.js';
import { dayClassOf, formatMinute, localParts, weekdayOf } from './time.js';
import { groupByLocalDate, occupancyEvents } from './occupancy.js';
import type {
  ActivityEvent,
  ActivityKind,
  Anchor,
  Baseline,
  DayClass,
  HouseholdConfig,
} from './types.js';

export interface LearnOptions {
  /**
   * Days of a given class needed before we will trust any anchor from it.
   * Two working weeks is the floor: fewer and a single odd week defines normal.
   */
  readonly minObservedDays: number;
  /**
   * Fraction of days a milestone must appear on to become an anchor.
   *
   * The most consequential number in the system. An anchor absent on 12% of
   * normal days will, by construction, fire on 12% of normal days — roughly
   * three nudges a month for a habit the resident simply does not always keep.
   * That is not a signal, it is a habit we have mistaken for a rule.
   *
   * At 0.9 an anchor must hold on more than nine days in ten before we are
   * willing to wake anybody over its absence. Households too irregular to clear
   * that bar end up with very few anchors, which is the honest outcome: better to
   * watch one thing reliably than five things badly.
   */
  readonly minReliability: number;
  /** Quantile of observed times treated as the late edge of normal. */
  readonly lateQuantile: number;
}

export const DEFAULT_LEARN_OPTIONS: LearnOptions = {
  minObservedDays: 10,
  minReliability: 0.95,
  lateQuantile: 0.95,
};

/** The milestones we look for, before filtering. */
interface Candidate {
  readonly key: string;
  readonly label: string;
  readonly zone: string | null;
  readonly kind: ActivityKind | null;
}

function firstActivityCandidate(): Candidate {
  return {
    key: 'first_activity',
    label: 'first sign of activity',
    zone: null,
    kind: null,
  };
}

function zoneCandidate(zone: string, kind: ActivityKind): Candidate {
  return {
    key: `activity:${zone}:${kind}`,
    label: `${kind === 'door_open' ? 'opening the' : 'activity in the'} ${zone.replace(/_/g, ' ')}`,
    zone,
    kind,
  };
}

function matches(event: ActivityEvent, candidate: Candidate): boolean {
  if (candidate.zone === null) return true;
  return event.zone === candidate.zone && event.kind === candidate.kind;
}

/**
 * Learns a household's routine from historical events.
 *
 * The output is deliberately a small set of named, explainable milestones rather
 * than a statistical model of the whole day. When this system wakes a family at
 * midday it has to be able to say *which* habit was missed and *when* it was
 * expected — "unusual activity detected" is exactly the alert people learn to
 * ignore.
 */
export function learnBaseline(
  events: readonly ActivityEvent[],
  config: HouseholdConfig,
  options: LearnOptions = DEFAULT_LEARN_OPTIONS,
): Baseline {
  const relevant = occupancyEvents(events, config);
  const days = groupByLocalDate(relevant, config.timeZone);

  // Candidate milestones are discovered from the data, not hardcoded, so the
  // system adapts to whatever zones a household actually has installed.
  const candidates = new Map<string, Candidate>();
  const firstActivity = firstActivityCandidate();
  candidates.set(firstActivity.key, firstActivity);
  for (const event of relevant) {
    const candidate = zoneCandidate(event.zone, event.kind);
    candidates.set(candidate.key, candidate);
  }

  // Per day class: how many days did we see, and on those days when did each
  // milestone first occur?
  const observedDays: Record<DayClass, number> = { weekday: 0, weekend: 0 };
  const occurrences = new Map<string, Record<DayClass, number[]>>();
  for (const candidate of candidates.keys()) {
    occurrences.set(candidate, { weekday: [], weekend: [] });
  }

  for (const [dateKey, dayEvents] of days) {
    const dayClass = dayClassOf(weekdayOf(dateKey));
    observedDays[dayClass] += 1;
    for (const candidate of candidates.values()) {
      const first = dayEvents.find((event) => matches(event, candidate));
      if (first === undefined) continue;
      const bucket = occurrences.get(candidate.key);
      if (bucket === undefined) continue;
      bucket[dayClass].push(localParts(first.at, config.timeZone).minutesOfDay);
    }
  }

  const anchors: Anchor[] = [];
  for (const candidate of candidates.values()) {
    const bucket = occurrences.get(candidate.key);
    if (bucket === undefined) continue;
    for (const dayClass of ['weekday', 'weekend'] as const) {
      const minutes = bucket[dayClass];
      const seen = observedDays[dayClass];
      if (seen < options.minObservedDays) continue;
      const reliability = minutes.length / seen;
      if (reliability < options.minReliability) continue;
      anchors.push({
        key: candidate.key,
        label: candidate.label,
        zone: candidate.zone,
        kind: candidate.kind,
        dayClass,
        medianMinute: Math.round(median(minutes)),
        madMinutes: Math.round(medianAbsoluteDeviation(minutes)),
        lateMinute: Math.round(quantile(minutes, options.lateQuantile)),
        observedDays: seen,
        presentDays: minutes.length,
        reliability,
      });
    }
  }

  anchors.sort((a, b) => a.medianMinute - b.medianMinute || a.key.localeCompare(b.key));

  const timestamps = relevant.map((event) => event.at);
  return {
    householdId: config.householdId,
    timeZone: config.timeZone,
    anchors,
    daysObserved: days.size,
    windowStart: timestamps.length > 0 ? Math.min(...timestamps) : 0,
    windowEnd: timestamps.length > 0 ? Math.max(...timestamps) : 0,
  };
}

/** Anchors that apply to a given kind of day. */
export function anchorsFor(baseline: Baseline, dayClass: DayClass): readonly Anchor[] {
  return baseline.anchors.filter((anchor) => anchor.dayClass === dayClass);
}

/**
 * The local minute by which an anchor's activity should have appeared.
 *
 * Built from the late edge of what this household actually does, plus a fixed
 * grace period. The MAD term is kept only as a floor for the rare case where the
 * observed tail is implausibly tight, so a very regular household still is not
 * given a hair-trigger. A predictable routine is a reason for confidence, not for
 * impatience.
 */
export function deadlineMinute(
  anchor: Anchor,
  spreadMultiplier: number,
  graceMinutes: number,
): number {
  const lateEdge = Math.max(
    anchor.lateMinute,
    anchor.medianMinute + anchor.madMinutes * spreadMultiplier,
  );
  return lateEdge + graceMinutes;
}

/** One-line human summary, used in the UI and as LLM input. */
export function describeAnchor(anchor: Anchor): string {
  return `${anchor.label} usually by ${formatMinute(anchor.medianMinute)} on a ${anchor.dayClass === 'weekday' ? 'working day' : 'weekend day'} (typical ${formatMinute(
    anchor.medianMinute,
  )}, spread ${anchor.madMinutes}m across ${anchor.presentDays} of ${anchor.observedDays} days)`;
}
