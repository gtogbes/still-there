import { describe, expect, it } from 'vitest';
import {
  adaptActivityEvent,
  adaptDeviceHealth,
  adaptDeviceStatus,
  hasEverReported,
} from '../src/ring/adapter.js';
import { buildDeviceRegistry, unmappedDevices } from '../src/ring/devices.js';

/**
 * Contract tests for the Ring seam.
 *
 * These fixtures follow Ring's documented webhook v1.1 envelope rather than a
 * guess. An earlier version of this file invented a flat payload and was wrong
 * about nearly every field name, which is a decent argument for reading the
 * specification before writing the parser.
 *
 * Still to do: replace these with captures from live sandbox deliveries. The
 * shape is now right in principle; only real traffic proves it.
 */

const registry = buildDeviceRegistry({
  'dev-hallway': 'hallway',
  'dev-kitchen': 'kitchen',
  'dev-front': 'front_door',
  'dev-front-contact': 'front_door',
});

function webhook(
  type: string,
  deviceId: string,
  timestamp: number,
  extra: Record<string, unknown> = {},
): unknown {
  return {
    meta: {
      version: '1.1',
      time: new Date(timestamp).toISOString(),
      request_id: `req-${type}-${timestamp}`,
      account_id: 'acct-ese',
    },
    data: {
      id: `evt-${type}-${timestamp}`,
      type,
      ...extra,
      attributes: { source: deviceId, source_type: 'devices', timestamp },
      relationships: { devices: { links: { self: `/v1/devices/${deviceId}` } } },
    },
  };
}

describe('activity events', () => {
  it('unpacks a motion event from the v1.1 envelope', () => {
    const result = adaptActivityEvent(
      webhook('motion_detected', 'dev-hallway', 1_757_492_100_000, { subType: 'human' }),
      registry,
    );
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.value.event.zone).toBe('hallway');
    expect(result.value.event.kind).toBe('motion');
    expect(result.value.event.at).toBe(1_757_492_100_000);
    expect(result.value.event.subject).toBe('human');
  });

  it('carries request_id through for deduplication', () => {
    // Ring may deliver the same detection more than once, and a replayed event
    // must not read as a second visit to the kitchen.
    const result = adaptActivityEvent(
      webhook('motion_detected', 'dev-kitchen', 1_757_492_100_000),
      registry,
    );
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.value.context.requestId).toBe('req-motion_detected-1757492100000');
    expect(result.value.context.accountId).toBe('acct-ese');
  });

  it('reads a contact sensor fault as a door opening', () => {
    // "Faulted" means open. Counter-intuitive, documented, and the strongest
    // occupancy signal available — somebody physically moved a door.
    const result = adaptActivityEvent(
      webhook('contact_sensor_faulted', 'dev-front-contact', 1_757_492_100_000),
      registry,
    );
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.value.event.kind).toBe('door_open');
  });

  it('reads a contact sensor clear as a door closing', () => {
    const result = adaptActivityEvent(
      webhook('contact_sensor_cleared', 'dev-front-contact', 1_757_492_100_000),
      registry,
    );
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.value.event.kind).toBe('door_closed');
  });

  it('maps a doorbell press', () => {
    const result = adaptActivityEvent(
      webhook('button_press', 'dev-front', 1_757_492_100_000),
      registry,
    );
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.value.event.kind).toBe('doorbell');
  });

  describe('motion classification', () => {
    const cases: readonly [string, string][] = [
      ['human', 'human'],
      ['vehicle', 'vehicle'],
      ['other_motion', 'other'],
      ['motion', 'unspecified'],
    ];

    it.each(cases)("maps subType '%s' to subject '%s'", (subType, expected) => {
      const result = adaptActivityEvent(
        webhook('motion_detected', 'dev-hallway', 1, { subType }),
        registry,
      );
      expect(result.outcome).toBe('ok');
      if (result.outcome !== 'ok') return;
      expect(result.value.event.subject).toBe(expected);
    });

    it('treats an unknown classification as other, not unspecified', () => {
      // Ring says new subTypes may appear. 'unspecified' is trusted as occupancy
      // evidence by default, so an unrecognised label must not inherit that
      // trust and quietly become proof that someone is up.
      const result = adaptActivityEvent(
        webhook('motion_detected', 'dev-hallway', 1, { subType: 'pet_detected' }),
        registry,
      );
      expect(result.outcome).toBe('ok');
      if (result.outcome !== 'ok') return;
      expect(result.value.event.subject).toBe('other');
    });

    it('defaults to unspecified when no subType is present', () => {
      const result = adaptActivityEvent(webhook('motion_detected', 'dev-hallway', 1), registry);
      expect(result.outcome).toBe('ok');
      if (result.outcome !== 'ok') return;
      expect(result.value.event.subject).toBe('unspecified');
    });

    it('does not attach a subject to non-motion events', () => {
      const result = adaptActivityEvent(
        webhook('contact_sensor_faulted', 'dev-front-contact', 1, { subType: 'human' }),
        registry,
      );
      expect(result.outcome).toBe('ok');
      if (result.outcome !== 'ok') return;
      expect(result.value.event.subject).toBe('unspecified');
    });
  });

  it('ignores a device nobody has placed in a zone', () => {
    const result = adaptActivityEvent(webhook('motion_detected', 'dev-unknown', 1), registry);
    expect(result.outcome).toBe('ignored');
  });

  it('ignores events we expect but do not use', () => {
    const expected = [
      'subscription_activated',
      'app_integration_added',
      'device_added',
      'flood_detected',
      'temperature_exceeded',
      'tamper_cleared',
    ];
    for (const type of expected) {
      const result = adaptActivityEvent(webhook(type, 'dev-hallway', 1), registry);
      expect(result.outcome, type).toBe('ignored');
    }
  });

  it('reports a genuinely unknown event type as invalid', () => {
    const result = adaptActivityEvent(webhook('quantum_tunnelling', 'dev-hallway', 1), registry);
    expect(result.outcome).toBe('invalid');
  });

  it('names the level at which an unexpected shape failed', () => {
    // The point of being strict. A failed delivery should hand us Ring's actual
    // structure rather than a shrug.
    const flat = { eventType: 'motion', deviceId: 'dev-hallway', occurredAt: 1 };
    const result = adaptActivityEvent(flat, registry);
    expect(result.outcome).toBe('invalid');
    if (result.outcome !== 'invalid') return;
    expect(result.reason).toContain('data');
    expect(result.reason).toContain('eventType');
  });

  it('reports a missing source inside attributes', () => {
    const result = adaptActivityEvent(
      { meta: {}, data: { id: 'e', type: 'motion_detected', attributes: { timestamp: 1 } } },
      registry,
    );
    expect(result.outcome).toBe('invalid');
    if (result.outcome !== 'invalid') return;
    expect(result.reason).toContain('source');
  });

  it('rejects non-objects without throwing', () => {
    for (const payload of [null, undefined, 'motion', 42, []]) {
      expect(() => adaptActivityEvent(payload, registry)).not.toThrow();
      expect(adaptActivityEvent(payload, registry).outcome).toBe('invalid');
    }
  });
});

describe('device health from webhooks', () => {
  it('reads device_offline as not observable', () => {
    const result = adaptDeviceHealth(
      webhook('device_offline', 'dev-kitchen', 1_757_492_100_000),
      registry,
    );
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.value.sample.online).toBe(false);
    expect(result.value.sample.zone).toBe('kitchen');
  });

  it('reads device_online as observable', () => {
    const result = adaptDeviceHealth(webhook('device_online', 'dev-kitchen', 1), registry);
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.value.sample.online).toBe(true);
  });

  it('ignores activity events handed to the wrong adapter', () => {
    const result = adaptDeviceHealth(webhook('motion_detected', 'dev-hallway', 1), registry);
    expect(result.outcome).toBe('ignored');
  });
});

describe('device health from the status endpoint', () => {
  const status = (attributes: Record<string, unknown>): unknown => ({
    data: { type: 'device-status', id: 'st-1', attributes },
  });

  it('reads online state and battery', () => {
    const result = adaptDeviceStatus(
      status({
        online: true,
        reported_at: '2026-09-10T07:35:00Z',
        battery_status: { percentage: 85 },
      }),
      'dev-kitchen',
      registry,
    );
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.value.online).toBe(true);
    expect(result.value.batteryPercent).toBe(85);
  });

  it('refuses to trust a device that has never reported', () => {
    // Ring returns the Unix epoch for reported_at in this case. A naive check
    // reads that as "last seen in 1970" and, worse, `online` can still be true —
    // so without this guard a camera that has never once checked in would be
    // treated as actively watching an empty hallway.
    const result = adaptDeviceStatus(
      status({ online: true, reported_at: '1970-01-01T00:00:00Z' }),
      'dev-kitchen',
      registry,
    );
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.value.online).toBe(false);
  });

  it('copes with battery and signal absent before first check-in', () => {
    const result = adaptDeviceStatus(
      status({ online: true, reported_at: '2026-09-10T07:35:00Z' }),
      'dev-kitchen',
      registry,
    );
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.value.batteryPercent).toBeUndefined();
  });

  it('identifies the never-reported sentinel', () => {
    expect(hasEverReported(0)).toBe(false);
    expect(hasEverReported(Date.parse('1970-01-01T00:00:00Z'))).toBe(false);
    expect(hasEverReported(Date.parse('2026-09-10T07:35:00Z'))).toBe(true);
  });

  it('reports a malformed status response as invalid', () => {
    expect(adaptDeviceStatus({ nonsense: true }, 'dev-kitchen', registry).outcome).toBe('invalid');
  });
});

describe('device registry', () => {
  it('flags devices that need placing', () => {
    expect(unmappedDevices(registry, ['dev-hallway', 'dev-landing', 'dev-shed'])).toEqual([
      'dev-landing',
      'dev-shed',
    ]);
  });
});
