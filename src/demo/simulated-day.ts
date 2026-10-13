import { addDays, fromLocal, localParts } from '../domain/time.js';
import type { ActivityEvent, DeviceHealthSample } from '../domain/types.js';
import { generateHistory } from '../testing/generator.js';
import type { Persona } from '../testing/personas.js';

/**
 * The simulated household's day, decided at midnight.
 *
 * The demo has to work on whatever day a judge opens it, and the judging window is
 * two weeks long. A household seeded once goes wrong within hours: device health
 * goes stale, yesterday's broken morning becomes part of the learned "normal", and
 * the messages on the phone belong to a different date.
 *
 * So the whole day is produced in advance, the way a test fixture would be:
 *
 *   - six weeks of ordinary history ending yesterday, so the baseline is always full
 *   - today with every habit missing — the morning nobody got up — and the street
 *     noise left in, so "nothing happened" is a finding rather than an empty table
 *   - camera check-ins covering the whole of today, so the demo clock can be moved to
 *     12:30 at three in the morning without every camera reading as stale
 *
 * Pure: no I/O and no clock. The handler supplies `now` and writes the result.
 */

export const HISTORY_DAYS = 42;

/** Seeds fixed so a given date always produces the same history. */
const HISTORY_SEED = 20260925;
const TODAY_SEED = 999;

export interface SimulatedDay {
  readonly today: string;
  /** Inclusive start of everything this day replaces, as an instant. */
  readonly replaceFrom: number;
  /** Exclusive end: midnight tomorrow. */
  readonly replaceUntil: number;
  readonly events: readonly ActivityEvent[];
  readonly health: readonly DeviceHealthSample[];
}

export function simulatedDay(persona: Persona, now: number): SimulatedDay {
  const tz = persona.config.timeZone;
  const today = localParts(now, tz).dateKey;
  const historyStart = addDays(today, -HISTORY_DAYS);

  const history = generateHistory(persona, {
    startDateKey: historyStart,
    days: HISTORY_DAYS,
    seed: HISTORY_SEED,
  });

  const morningThatDidNotHappen = generateHistory(persona, {
    startDateKey: today,
    days: 1,
    seed: TODAY_SEED,
    omit: () => true,
  });

  // The last minute of today. A camera that "reported" then is, for the purpose of
  // any moment today, a camera that was watching.
  const endOfToday = fromLocal(addDays(today, 1), 0, tz) - 60_000;

  return {
    today,
    replaceFrom: fromLocal(historyStart, 0, tz),
    replaceUntil: fromLocal(addDays(today, 1), 0, tz),
    events: [...history, ...morningThatDidNotHappen],
    health: persona.devices.map((device) => ({
      deviceId: device.deviceId,
      zone: device.zone,
      online: true,
      lastSeenAt: endOfToday,
      batteryPercent: 84,
    })),
  };
}

/**
 * The moments the deployed assessment is run at, one per severity level.
 *
 * The notification policy sends at most one message per level, so a morning where
 * nobody got up produces exactly these three.
 */
export const SCRIPTED_MOMENTS = [9 * 60, 10 * 60 + 45, 12 * 60 + 30] as const;
