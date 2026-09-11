import type { ActivityEvent, HouseholdConfig } from './types.js';
import { isQuietMinute, localParts } from './time.js';

/**
 * Not every event is evidence that the resident is alive and moving.
 *
 * A Ring doorbell facing the street fires on passing cars, the postman, next
 * door's cat. If exterior motion counted as occupancy, the system would happily
 * report a normal morning for a house nobody had got out of bed in — the single
 * most dangerous false negative this product can produce.
 *
 * So occupancy evidence is narrow and deliberate: movement inside the home, or
 * a door being physically opened. Everything else is context, not proof.
 */
export function isOccupancyEvidence(event: ActivityEvent, config: HouseholdConfig): boolean {
  if (event.kind === 'door_open') return true;
  if (event.kind === 'vehicle' || event.kind === 'package') return false;
  return config.interiorZones.includes(event.zone);
}

/**
 * Events that count as occupancy evidence during the household's waking hours.
 *
 * Night events are excluded so a 3am trip to the bathroom does not become "first
 * activity of the day" and drag the morning anchor back by four hours.
 */
export function occupancyEvents(
  events: readonly ActivityEvent[],
  config: HouseholdConfig,
): ActivityEvent[] {
  return events.filter((event) => {
    if (!isOccupancyEvidence(event, config)) return false;
    const { minutesOfDay } = localParts(event.at, config.timeZone);
    return !isQuietMinute(minutesOfDay, config.quietFromMinute, config.quietToMinute);
  });
}

/** Groups events by local calendar date. */
export function groupByLocalDate(
  events: readonly ActivityEvent[],
  timeZone: string,
): Map<string, ActivityEvent[]> {
  const days = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    const { dateKey } = localParts(event.at, timeZone);
    const bucket = days.get(dateKey);
    if (bucket === undefined) {
      days.set(dateKey, [event]);
    } else {
      bucket.push(event);
    }
  }
  for (const bucket of days.values()) {
    bucket.sort((a, b) => a.at - b.at);
  }
  return days;
}
