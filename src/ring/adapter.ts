import type {
  ActivityEvent,
  ActivityKind,
  DeviceHealthSample,
  MotionSubject,
} from '../domain/types.js';
import { zoneForDevice, type DeviceRegistry } from './devices.js';

/**
 * The seam between Ring's wire format and our domain.
 *
 * Everything downstream speaks ActivityEvent and DeviceHealthSample and knows
 * nothing about Ring. Field paths below are taken from Ring's webhook v1.1
 * specification rather than inferred — an earlier version of this file guessed a
 * flat payload and was wrong about almost every name.
 *
 * Ring uses two different vocabularies for the same events, which is worth
 * knowing before reading further: webhooks say `motion_detected` and
 * `button_press`, while the Event History API says `motion` and `ding`. Both are
 * handled here, kept apart deliberately.
 */

export type AdaptResult<T> =
  | { readonly outcome: 'ok'; readonly value: T }
  /** Understood, but not something this product reasons about. Acknowledge and move on. */
  | { readonly outcome: 'ignored'; readonly reason: string }
  /** Could not be understood. Still acknowledge to Ring, but alert ourselves. */
  | { readonly outcome: 'invalid'; readonly reason: string };

/** What the webhook envelope carries beyond the event itself. */
export interface EnvelopeContext {
  /** Deduplication key. Ring may deliver the same detection more than once. */
  readonly requestId: string;
  /** Identifies which linked Ring user the event belongs to. */
  readonly accountId: string;
  readonly eventId: string;
}

export interface AdaptedActivity {
  readonly event: ActivityEvent;
  readonly context: EnvelopeContext;
}

export interface AdaptedHealth {
  readonly sample: DeviceHealthSample;
  readonly context: EnvelopeContext;
}

/** Webhook `data.type` values that describe someone moving about. */
const ACTIVITY_KINDS: Readonly<Record<string, ActivityKind>> = {
  motion_detected: 'motion',
  button_press: 'doorbell',
  // Counter-intuitive but documented: "faulted" means the contact is open.
  // Read the attribute, not the name.
  contact_sensor_faulted: 'door_open',
  contact_sensor_cleared: 'door_closed',
  tamper_detected: 'tamper',
};

/** Ring's motion classifications mapped to ours. */
const MOTION_SUBJECTS: Readonly<Record<string, MotionSubject>> = {
  human: 'human',
  vehicle: 'vehicle',
  other_motion: 'other',
  motion: 'unspecified',
};

const DEVICE_STATUS_TYPES: readonly string[] = ['device_online', 'device_offline'];

/**
 * Events we expect and deliberately discard.
 *
 * Enumerated rather than caught by a default branch, so a genuinely unknown type
 * still surfaces as 'invalid'. The distinction is operational: 'invalid' should
 * alert somebody, and a subscription renewal should not.
 */
const IGNORED_TYPES: readonly string[] = [
  'tamper_cleared',
  'device_added',
  'device_removed',
  'subscription_activated',
  'subscription_deactivated',
  'app_integration_added',
  'app_integration_removed',
  'flood_detected',
  'flood_cleared',
  'freeze_detected',
  'freeze_cleared',
  'temperature_exceeded',
  'temperature_cleared',
  'humidity_exceeded',
  'humidity_cleared',
  'pm25_exceeded',
  'pm25_cleared',
  'co_exceeded',
  'co_cleared',
];

function describeShape(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return typeof payload;
  return Object.keys(payload as Record<string, unknown>).join(', ') || '(no keys)';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  if (source === undefined) return undefined;
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Accepts epoch milliseconds or an ISO-8601 string. */
function readInstant(source: Record<string, unknown> | undefined, key: string): number | undefined {
  if (source === undefined) return undefined;
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

interface Envelope {
  readonly eventType: string;
  readonly deviceId: string;
  readonly at: number;
  readonly context: EnvelopeContext;
  readonly data: Record<string, unknown>;
}

/**
 * Unpacks the v1.1 envelope shared by every Ring webhook.
 *
 * Diagnostic on purpose. A tolerant reader that accepted several field spellings
 * would have hidden the fact that this file was previously wrong; instead an
 * unrecognised payload reports the keys it actually contained, so one failed
 * delivery tells us what changed.
 */
function readEnvelope(payload: unknown): AdaptResult<Envelope> {
  const root = asRecord(payload);
  if (root === undefined) {
    return { outcome: 'invalid', reason: `expected an object, received ${describeShape(payload)}` };
  }

  const meta = asRecord(root['meta']);
  const data = asRecord(root['data']);
  if (data === undefined) {
    return {
      outcome: 'invalid',
      reason: `no 'data' object. Top-level keys: ${describeShape(root)}`,
    };
  }

  const eventType = readString(data, 'type');
  if (eventType === undefined) {
    return { outcome: 'invalid', reason: `no data.type. data keys: ${describeShape(data)}` };
  }

  const attributes = asRecord(data['attributes']);
  const deviceId = readString(attributes, 'source');
  if (deviceId === undefined) {
    return {
      outcome: 'invalid',
      reason: `no data.attributes.source. attribute keys: ${describeShape(attributes)}`,
    };
  }

  const at = readInstant(attributes, 'timestamp');
  if (at === undefined) {
    return {
      outcome: 'invalid',
      reason: `no usable data.attributes.timestamp. attribute keys: ${describeShape(attributes)}`,
    };
  }

  const eventId = readString(data, 'id') ?? `${deviceId}-${eventType}-${at}`;

  return {
    outcome: 'ok',
    value: {
      eventType,
      deviceId,
      at,
      data,
      context: {
        // Ring documents request_id as the deduplication key and warns it may
        // carry a truncated internal name — opaque, never parsed.
        requestId: readString(meta, 'request_id') ?? eventId,
        accountId: readString(meta, 'account_id') ?? '',
        eventId,
      },
    },
  };
}

function readSubject(data: Record<string, unknown>): MotionSubject {
  const raw = readString(data, 'subType');
  if (raw === undefined) return 'unspecified';
  // An unrecognised classification becomes 'other' rather than 'unspecified'.
  // Ring says new values may appear, and 'unspecified' is trusted as occupancy
  // evidence by default — so an unknown label must not inherit that trust.
  return MOTION_SUBJECTS[raw] ?? 'other';
}

export function adaptActivityEvent(
  payload: unknown,
  registry: DeviceRegistry,
): AdaptResult<AdaptedActivity> {
  const envelope = readEnvelope(payload);
  if (envelope.outcome !== 'ok') return envelope;
  const { eventType, deviceId, at, data, context } = envelope.value;

  if (DEVICE_STATUS_TYPES.includes(eventType)) {
    return { outcome: 'ignored', reason: `'${eventType}' is a device status event, not activity` };
  }
  if (IGNORED_TYPES.includes(eventType)) {
    return { outcome: 'ignored', reason: `'${eventType}' is not used by this product` };
  }

  const kind = ACTIVITY_KINDS[eventType];
  if (kind === undefined) {
    return { outcome: 'invalid', reason: `unrecognised data.type '${eventType}'` };
  }

  const zone = zoneForDevice(registry, deviceId);
  if (zone === undefined) {
    // Ring did its job. The household simply has a device nobody has placed yet,
    // and guessing a zone is worse than declining — a wrong zone silently
    // corrupts the interior/exterior distinction the whole model rests on.
    return { outcome: 'ignored', reason: `device '${deviceId}' is not mapped to a zone` };
  }

  return {
    outcome: 'ok',
    value: {
      event: {
        id: context.eventId,
        deviceId,
        zone,
        kind,
        at,
        subject: kind === 'motion' ? readSubject(data) : 'unspecified',
      },
      context,
    },
  };
}

/**
 * A device that has never reported.
 *
 * Ring returns the Unix epoch for `reported_at` in that case, which a naive
 * staleness check reads as "last seen in 1970" — technically the safe direction,
 * but worth naming so it is never mistaken for a real timestamp.
 */
const NEVER_REPORTED_BEFORE = Date.parse('1971-01-01T00:00:00Z');

export function hasEverReported(lastSeenAt: number): boolean {
  return lastSeenAt > NEVER_REPORTED_BEFORE;
}

export function adaptDeviceHealth(
  payload: unknown,
  registry: DeviceRegistry,
): AdaptResult<AdaptedHealth> {
  const envelope = readEnvelope(payload);
  if (envelope.outcome !== 'ok') return envelope;
  const { eventType, deviceId, at, context } = envelope.value;

  if (!DEVICE_STATUS_TYPES.includes(eventType)) {
    return { outcome: 'ignored', reason: `'${eventType}' is not a device status event` };
  }

  const zone = zoneForDevice(registry, deviceId);
  if (zone === undefined) {
    return { outcome: 'ignored', reason: `device '${deviceId}' is not mapped to a zone` };
  }

  return {
    outcome: 'ok',
    value: {
      sample: {
        deviceId,
        zone,
        online: eventType === 'device_online',
        lastSeenAt: at,
      },
      context,
    },
  };
}

/**
 * Device status read from `GET /v1/devices/{id}/status` rather than a webhook.
 *
 * Needed because `device_offline` for a sensor is a heartbeat timeout and lags
 * the actual loss of connectivity, so the status endpoint is the authority. Ring
 * also documents three traps here, all handled below: `battery_status` and
 * `signal_strength` are absent until first check-in, `reported_at` is the epoch
 * for a device that has never reported, and `sensor_reporting_state` reads
 * 'active' even then — so it says nothing about liveness.
 */
export function adaptDeviceStatus(
  payload: unknown,
  deviceId: string,
  registry: DeviceRegistry,
): AdaptResult<DeviceHealthSample> {
  const root = asRecord(payload);
  const data = asRecord(root?.['data']);
  const attributes = asRecord(data?.['attributes']);
  if (attributes === undefined) {
    return {
      outcome: 'invalid',
      reason: `no data.attributes. shape: ${describeShape(payload)}`,
    };
  }

  const zone = zoneForDevice(registry, deviceId);
  if (zone === undefined) {
    return { outcome: 'ignored', reason: `device '${deviceId}' is not mapped to a zone` };
  }

  const online = attributes['online'] === true;
  const reportedAt = readInstant(attributes, 'reported_at') ?? 0;
  const battery = asRecord(attributes['battery_status'])?.['percentage'];

  return {
    outcome: 'ok',
    value: {
      deviceId,
      zone,
      // A device that has never checked in cannot be treated as watching,
      // whatever `online` claims.
      online: online && hasEverReported(reportedAt),
      lastSeenAt: reportedAt,
      ...(typeof battery === 'number' && Number.isFinite(battery)
        ? { batteryPercent: battery }
        : {}),
    },
  };
}
