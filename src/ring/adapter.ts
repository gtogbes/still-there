import type { ActivityEvent, ActivityKind, DeviceHealthSample } from '../domain/types.js';
import { zoneForDevice, type DeviceRegistry } from './devices.js';

/**
 * The seam between Ring's wire format and our domain.
 *
 * Everything downstream of here speaks ActivityEvent and DeviceHealthSample and
 * knows nothing about Ring. That is the point: the payload shapes below are
 * still provisional, inferred from the developer documentation rather than
 * captured from a live webhook, and when they turn out to be wrong the change
 * lands in this one file.
 *
 * Deliberately diagnostic rather than tolerant. It would be easy to accept half
 * a dozen field aliases and quietly coerce whatever arrives, and we would then
 * never find out what Ring actually sends. Instead an unrecognised payload comes
 * back as 'invalid' listing the keys it did contain, so the first failed webhook
 * tells us the real shape.
 */

export type AdaptResult<T> =
  | { readonly outcome: 'ok'; readonly value: T }
  /** Understood, but not something this product reasons about. Acknowledge and move on. */
  | { readonly outcome: 'ignored'; readonly reason: string }
  /** Could not be understood. Acknowledge to Ring, but alert ourselves. */
  | { readonly outcome: 'invalid'; readonly reason: string };

/**
 * Ring event type names mapped to our vocabulary.
 *
 * Scope groups requested for this app are Cameras and Doorbells (motion,
 * doorbell presses) and Contact Sensors (door open/close), plus the Account and
 * Lifecycle events every app receives automatically.
 */
const ACTIVITY_KINDS: Readonly<Record<string, ActivityKind>> = {
  motion: 'motion',
  motion_detected: 'motion',
  ding: 'doorbell',
  doorbell_press: 'doorbell',
  contact_open: 'door_open',
  door_opened: 'door_open',
  package_detected: 'package',
  vehicle_detected: 'vehicle',
};

/**
 * Events we expect to receive and deliberately do nothing with.
 *
 * Listed explicitly so they come back as 'ignored' rather than 'invalid'. The
 * difference matters operationally: 'invalid' should wake somebody, and a
 * subscription renewal notice should not.
 */
const IGNORED_TYPES: readonly string[] = [
  'contact_closed',
  'door_closed',
  'subscription_changed',
  'integration_enabled',
  'integration_disabled',
  'livestream_started',
  'livestream_ended',
];

const DEVICE_STATUS_TYPES: readonly string[] = ['device_online', 'device_offline', 'device_status'];

function keysOf(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return typeof payload;
  return Object.keys(payload as Record<string, unknown>).join(', ') || '(no keys)';
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Accepts an ISO-8601 string or epoch milliseconds. Rejects anything else. */
function readInstant(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

export function adaptActivityEvent(
  payload: unknown,
  registry: DeviceRegistry,
): AdaptResult<ActivityEvent> {
  if (typeof payload !== 'object' || payload === null) {
    return { outcome: 'invalid', reason: `expected an object, received ${keysOf(payload)}` };
  }
  const body = payload as Record<string, unknown>;

  const type = readString(body, 'eventType') ?? readString(body, 'type');
  if (type === undefined) {
    return {
      outcome: 'invalid',
      reason: `no eventType or type field. Keys present: ${keysOf(body)}`,
    };
  }

  if (DEVICE_STATUS_TYPES.includes(type)) {
    return { outcome: 'ignored', reason: `'${type}' is a device status event, not activity` };
  }
  if (IGNORED_TYPES.includes(type)) {
    return { outcome: 'ignored', reason: `'${type}' is not used by this product` };
  }

  const kind = ACTIVITY_KINDS[type];
  if (kind === undefined) {
    return { outcome: 'invalid', reason: `unrecognised event type '${type}'` };
  }

  const deviceId = readString(body, 'deviceId') ?? readString(body, 'device_id');
  if (deviceId === undefined) {
    return { outcome: 'invalid', reason: `no deviceId. Keys present: ${keysOf(body)}` };
  }

  const at = readInstant(body, 'occurredAt') ?? readInstant(body, 'createdAt');
  if (at === undefined) {
    return { outcome: 'invalid', reason: `no usable occurredAt. Keys present: ${keysOf(body)}` };
  }

  const zone = zoneForDevice(registry, deviceId);
  if (zone === undefined) {
    // Not invalid — Ring did its job. The household simply has a device nobody
    // has placed yet, and inventing a zone here would be worse than declining.
    return {
      outcome: 'ignored',
      reason: `device '${deviceId}' is not mapped to a zone`,
    };
  }

  const id = readString(body, 'eventId') ?? readString(body, 'id') ?? `${deviceId}-${at}-${kind}`;

  return { outcome: 'ok', value: { id, deviceId, zone, kind, at } };
}

export function adaptDeviceHealth(
  payload: unknown,
  registry: DeviceRegistry,
): AdaptResult<DeviceHealthSample> {
  if (typeof payload !== 'object' || payload === null) {
    return { outcome: 'invalid', reason: `expected an object, received ${keysOf(payload)}` };
  }
  const body = payload as Record<string, unknown>;

  const type = readString(body, 'eventType') ?? readString(body, 'type');
  if (type === undefined || !DEVICE_STATUS_TYPES.includes(type)) {
    return { outcome: 'ignored', reason: `'${type ?? 'unknown'}' is not a device status event` };
  }

  const deviceId = readString(body, 'deviceId') ?? readString(body, 'device_id');
  if (deviceId === undefined) {
    return { outcome: 'invalid', reason: `no deviceId. Keys present: ${keysOf(body)}` };
  }

  const zone = zoneForDevice(registry, deviceId);
  if (zone === undefined) {
    return { outcome: 'ignored', reason: `device '${deviceId}' is not mapped to a zone` };
  }

  const at = readInstant(body, 'occurredAt') ?? readInstant(body, 'createdAt');
  if (at === undefined) {
    return { outcome: 'invalid', reason: `no usable occurredAt. Keys present: ${keysOf(body)}` };
  }

  // Derive liveness from the event type first, falling back to an explicit
  // field. Anything ambiguous is treated as offline, because assuming a camera
  // is watching when it is not is the failure that turns a blind spot into a
  // false welfare alert.
  const explicit = body['online'];
  const online =
    type === 'device_online' ? true : type === 'device_offline' ? false : explicit === true;

  const batteryRaw = body['batteryPercent'] ?? body['battery_percent'];
  const batteryPercent = typeof batteryRaw === 'number' && Number.isFinite(batteryRaw)
    ? batteryRaw
    : undefined;

  return {
    outcome: 'ok',
    value: {
      deviceId,
      zone,
      online,
      lastSeenAt: at,
      ...(batteryPercent === undefined ? {} : { batteryPercent }),
    },
  };
}
