import { addDays, fromLocal, weekdayOf } from '../domain/time.js';
import type { ActivityEvent, DeviceHealthSample } from '../domain/types.js';
import type { Persona, RoutineStep } from './personas.js';
import { jitter, mulberry32, randomInt } from './rng.js';

/**
 * Synthetic household generator.
 *
 * This exists because the system's premise — comparing today against weeks of
 * learned habit — cannot be tested in real time. Ring's Playground will simulate
 * an event happening now; it will not hand over six weeks of a specific person's
 * mornings. So we manufacture the history, and separately assert (in the contract
 * tests) that the shape we manufacture matches what Ring actually sends.
 */

export interface OmitContext {
  readonly dateKey: string;
  readonly dayIndex: number;
  readonly weekday: number;
  readonly step: RoutineStep;
}

export interface GenerateOptions {
  readonly startDateKey: string;
  readonly days: number;
  readonly seed: number;
  /** Return true to drop a habit on a given day. This is how anomalies are built. */
  readonly omit?: (context: OmitContext) => boolean;
  /** Set false to generate a clean stream with no ambient street activity. */
  readonly includeNoise?: boolean;
}

function deviceForZone(persona: Persona, zone: string): string {
  const device = persona.devices.find((candidate) => candidate.zone === zone);
  if (device === undefined) {
    throw new Error(`persona ${persona.name} has no device covering zone '${zone}'`);
  }
  return device.deviceId;
}

export function generateHistory(persona: Persona, options: GenerateOptions): ActivityEvent[] {
  const rng = mulberry32(options.seed);
  const events: ActivityEvent[] = [];
  let sequence = 0;

  const emit = (dateKey: string, minute: number, zone: string, kind: ActivityEvent['kind']): void => {
    sequence += 1;
    events.push({
      id: `${persona.config.householdId}-${sequence}`,
      deviceId: deviceForZone(persona, zone),
      zone,
      kind,
      at: fromLocal(dateKey, minute, persona.config.timeZone),
    });
  };

  for (let dayIndex = 0; dayIndex < options.days; dayIndex += 1) {
    const dateKey = addDays(options.startDateKey, dayIndex);
    const weekday = weekdayOf(dateKey);

    for (const step of persona.routine) {
      if (step.days !== undefined && !step.days.includes(weekday)) continue;
      if (options.omit?.({ dateKey, dayIndex, weekday, step }) === true) continue;
      if (rng() > step.probability) continue;

      const start = step.atMinute + jitter(rng, step.jitterMinutes);
      const repeats = step.repeats ?? 1;
      for (let burst = 0; burst < repeats; burst += 1) {
        emit(dateKey, start + burst * randomInt(rng, 1, 6), step.zone, step.kind);
      }
    }

    if (options.includeNoise !== false) {
      for (const source of persona.noise) {
        // Vary the count so the street is not suspiciously regular.
        const count = Math.max(0, Math.round(source.perDay * (0.5 + rng())));
        for (let n = 0; n < count; n += 1) {
          emit(dateKey, randomInt(rng, source.fromMinute, source.toMinute), source.zone, source.kind);
        }
      }
    }
  }

  events.sort((a, b) => a.at - b.at);
  return events;
}

/** Events falling on one local date. */
export function eventsOnDate(
  events: readonly ActivityEvent[],
  dateKey: string,
  timeZone: string,
): ActivityEvent[] {
  const from = fromLocal(dateKey, 0, timeZone);
  const to = fromLocal(addDays(dateKey, 1), 0, timeZone);
  return events.filter((event) => event.at >= from && event.at < to);
}

/** Every device awake and reporting. The baseline condition for a real deviation. */
export function healthySnapshot(persona: Persona, at: number): DeviceHealthSample[] {
  return persona.devices.map((device) => ({
    deviceId: device.deviceId,
    zone: device.zone,
    online: true,
    lastSeenAt: at - 60_000,
    batteryPercent: 84,
  }));
}

/**
 * Devices that cannot see anything: offline, flat, or silently stale.
 *
 * 'stale' is the nastiest of the three and the one worth testing hardest. The
 * device still claims to be online, it simply stopped sending telemetry an hour
 * ago, so a naive implementation trusts it and reports a welfare problem for a
 * house it has not heard from.
 */
export function blindSnapshot(
  persona: Persona,
  at: number,
  mode: 'offline' | 'flat_battery' | 'stale' = 'offline',
  zones?: readonly string[],
): DeviceHealthSample[] {
  return persona.devices.map((device) => {
    const affected = zones === undefined || zones.includes(device.zone);
    if (!affected) {
      return {
        deviceId: device.deviceId,
        zone: device.zone,
        online: true,
        lastSeenAt: at - 60_000,
        batteryPercent: 84,
      };
    }
    switch (mode) {
      case 'offline':
        return {
          deviceId: device.deviceId,
          zone: device.zone,
          online: false,
          lastSeenAt: at - 3 * 3_600_000,
          batteryPercent: 42,
        };
      case 'flat_battery':
        return {
          deviceId: device.deviceId,
          zone: device.zone,
          online: false,
          lastSeenAt: at - 6 * 3_600_000,
          batteryPercent: 0,
        };
      case 'stale':
        return {
          deviceId: device.deviceId,
          zone: device.zone,
          online: true,
          lastSeenAt: at - 4 * 3_600_000,
          batteryPercent: 61,
        };
    }
  });
}
