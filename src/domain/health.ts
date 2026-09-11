import type { DeviceHealthSample } from './types.js';

export interface ObservabilityOptions {
  /**
   * How stale telemetry may be before we stop trusting a device's silence.
   *
   * Set this shorter than the shortest anchor tolerance. A camera that last
   * checked in ninety minutes ago cannot be used to argue that nothing happened
   * an hour ago.
   */
  readonly maxTelemetryAgeMinutes: number;
}

export const DEFAULT_OBSERVABILITY_OPTIONS: ObservabilityOptions = {
  maxTelemetryAgeMinutes: 45,
};

export interface ObservabilityVerdict {
  readonly observable: boolean;
  /** Present when observable is false. Explains what we could not see, and why. */
  readonly blindReason?: string;
}

function isUsable(
  sample: DeviceHealthSample,
  evaluatedAt: number,
  options: ObservabilityOptions,
): boolean {
  if (!sample.online) return false;
  const ageMinutes = (evaluatedAt - sample.lastSeenAt) / 60_000;
  return ageMinutes <= options.maxTelemetryAgeMinutes;
}

/**
 * Could we actually have seen activity in this zone?
 *
 * Everything in this module exists to keep one specific accident from happening:
 * reporting "no movement all morning" when the truth is "the battery died on
 * Tuesday". Silence is only meaningful if something was listening, so absence of
 * events is never escalated without a device that was demonstrably awake.
 *
 * A zone of null means "anywhere in the home" and needs only one working device.
 */
export function assessObservability(
  zone: string | null,
  health: readonly DeviceHealthSample[],
  evaluatedAt: number,
  options: ObservabilityOptions = DEFAULT_OBSERVABILITY_OPTIONS,
): ObservabilityVerdict {
  const relevant = zone === null ? health : health.filter((sample) => sample.zone === zone);

  if (relevant.length === 0) {
    return {
      observable: false,
      blindReason:
        zone === null
          ? 'no devices are reporting from this home'
          : `no device covers the ${zone.replace(/_/g, ' ')}`,
    };
  }

  const usable = relevant.filter((sample) => isUsable(sample, evaluatedAt, options));
  if (usable.length > 0) return { observable: true };

  const offline = relevant.filter((sample) => !sample.online);
  const where = zone === null ? 'this home' : `the ${zone.replace(/_/g, ' ')}`;
  if (offline.length === relevant.length) {
    const flat = relevant.find(
      (sample) => sample.batteryPercent !== undefined && sample.batteryPercent <= 5,
    );
    const cause = flat === undefined ? 'offline' : 'offline with a flat battery';
    return { observable: false, blindReason: `the camera covering ${where} is ${cause}` };
  }

  const freshest = relevant.reduce((best, sample) =>
    sample.lastSeenAt > best.lastSeenAt ? sample : best,
  );
  const ageMinutes = Math.round((evaluatedAt - freshest.lastSeenAt) / 60_000);
  return {
    observable: false,
    blindReason: `the camera covering ${where} has not reported for ${ageMinutes} minutes`,
  };
}
