import type { ActivityKind, HouseholdConfig } from '../domain/types.js';

/** One habitual action in a persona's day. */
export interface RoutineStep {
  readonly zone: string;
  readonly kind: ActivityKind;
  /** Typical local minute-of-day. */
  readonly atMinute: number;
  /** Symmetric spread around that time. */
  readonly jitterMinutes: number;
  /** Chance it happens at all on an eligible day. */
  readonly probability: number;
  /** Restrict to certain weekdays, 0 = Sunday. Omit for every day. */
  readonly days?: readonly number[];
  /** Number of events in the burst. Real movement trips a sensor several times. */
  readonly repeats?: number;
}

/** Ambient events that are not evidence of the resident being up. */
export interface NoiseSource {
  readonly zone: string;
  readonly kind: ActivityKind;
  readonly perDay: number;
  readonly fromMinute: number;
  readonly toMinute: number;
}

export interface Persona {
  readonly name: string;
  readonly config: HouseholdConfig;
  readonly devices: readonly { readonly deviceId: string; readonly zone: string }[];
  readonly routine: readonly RoutineStep[];
  readonly noise: readonly NoiseSource[];
}

/**
 * Ese, 82. Regular as clockwork: up before eight, out for the paper, three
 * meals in the kitchen, shops on Tuesdays and Fridays, laundry upstairs twice a
 * week.
 *
 * The upstairs laundry trip is the important one. It appears on two of five
 * working days, so the reliability filter must *reject* it as an anchor. If it
 * were accepted the family would get three unnecessary nudges every week and the
 * product would be uninstalled inside a month. The shopping trip shares the
 * front-door anchor with the morning paper, so it needs no special handling.
 */
export const ese: Persona = {
  name: 'Ese',
  config: {
    householdId: 'household-ese',
    timeZone: 'Europe/London',
    interiorZones: ['hallway', 'kitchen', 'landing'],
    quietFromMinute: 23 * 60,
    quietToMinute: 6 * 60,
  },
  devices: [
    { deviceId: 'dev-front-door', zone: 'front_door' },
    { deviceId: 'dev-hallway', zone: 'hallway' },
    { deviceId: 'dev-kitchen', zone: 'kitchen' },
    { deviceId: 'dev-landing', zone: 'landing' },
  ],
  routine: [
    { zone: 'hallway', kind: 'motion', atMinute: 7 * 60 + 35, jitterMinutes: 20, probability: 1, repeats: 2 },
    { zone: 'front_door', kind: 'door_open', atMinute: 7 * 60 + 50, jitterMinutes: 20, probability: 1 },
    { zone: 'kitchen', kind: 'motion', atMinute: 8 * 60 + 15, jitterMinutes: 25, probability: 1, repeats: 3 },
    { zone: 'kitchen', kind: 'motion', atMinute: 12 * 60 + 30, jitterMinutes: 40, probability: 0.97, repeats: 2 },
    {
      zone: 'front_door',
      kind: 'door_open',
      atMinute: 13 * 60 + 30,
      jitterMinutes: 45,
      probability: 1,
      days: [2, 5],
    },
    // Laundry upstairs, Tuesdays and Fridays only. Must never become an anchor.
    {
      zone: 'landing',
      kind: 'motion',
      atMinute: 10 * 60,
      jitterMinutes: 30,
      probability: 1,
      days: [2, 5],
      repeats: 2,
    },
    { zone: 'kitchen', kind: 'motion', atMinute: 18 * 60 + 30, jitterMinutes: 40, probability: 0.97, repeats: 2 },
    { zone: 'hallway', kind: 'motion', atMinute: 21 * 60 + 15, jitterMinutes: 45, probability: 0.9 },
  ],
  noise: [
    // The street. Cars, the postman, next door's cat. None of it means Ese
    // is awake, and the system must not treat it as though it does.
    { zone: 'front_door', kind: 'motion', perDay: 14, fromMinute: 6 * 60, toMinute: 22 * 60 },
    { zone: 'front_door', kind: 'vehicle', perDay: 6, fromMinute: 7 * 60, toMinute: 20 * 60 },
    { zone: 'front_door', kind: 'package', perDay: 1, fromMinute: 9 * 60, toMinute: 17 * 60 },
  ],
};

/**
 * Nosa, 78. Housebound, broken sleep, no fixed mealtimes.
 *
 * The hard case. His routine is loose enough that most anchors should fail the
 * reliability threshold, and the honest outcome is a baseline that watches for
 * very little rather than one that invents structure and then alerts on noise.
 * A system that cannot say "I do not know this person well enough yet" will
 * eventually cry wolf.
 */
export const nosa: Persona = {
  name: 'Nosa',
  config: {
    householdId: 'household-nosa',
    timeZone: 'Europe/London',
    interiorZones: ['lounge', 'kitchen'],
    quietFromMinute: 24 * 60 - 30,
    quietToMinute: 5 * 60,
  },
  devices: [
    { deviceId: 'dev-nosa-front', zone: 'front_door' },
    { deviceId: 'dev-nosa-lounge', zone: 'lounge' },
    { deviceId: 'dev-nosa-kitchen', zone: 'kitchen' },
  ],
  routine: [
    { zone: 'lounge', kind: 'motion', atMinute: 9 * 60, jitterMinutes: 150, probability: 0.95, repeats: 2 },
    { zone: 'kitchen', kind: 'motion', atMinute: 11 * 60, jitterMinutes: 180, probability: 0.7 },
    { zone: 'kitchen', kind: 'motion', atMinute: 17 * 60, jitterMinutes: 200, probability: 0.6 },
    { zone: 'lounge', kind: 'motion', atMinute: 20 * 60, jitterMinutes: 160, probability: 0.85, repeats: 2 },
  ],
  noise: [{ zone: 'front_door', kind: 'motion', perDay: 5, fromMinute: 7 * 60, toMinute: 21 * 60 }],
};
