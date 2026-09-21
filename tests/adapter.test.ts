import { describe, expect, it } from 'vitest';
import { adaptActivityEvent, adaptDeviceHealth } from '../src/ring/adapter.js';
import { buildDeviceRegistry, unmappedDevices } from '../src/ring/devices.js';

/**
 * Contract tests for the Ring seam.
 *
 * Honest caveat: the payloads below are inferred from Ring's developer
 * documentation, not captured from a live webhook. They are placeholders with a
 * job — the moment real events arrive in the sandbox, these fixtures get replaced
 * with genuine captures and whatever breaks tells us what we guessed wrong.
 *
 * The behaviour being pinned is not the field names. It is that an unexpected
 * payload comes back diagnostic rather than silently coerced, and that an
 * unmapped device is never invented into a zone.
 */

const registry = buildDeviceRegistry({
  'dev-hallway': 'hallway',
  'dev-kitchen': 'kitchen',
  'dev-front': 'front_door',
  'dev-front-contact': 'front_door',
});

describe('activity events', () => {
  it('maps a motion event into the domain', () => {
    const result = adaptActivityEvent(
      {
        eventId: 'evt-1',
        eventType: 'motion',
        deviceId: 'dev-hallway',
        occurredAt: '2026-09-10T07:35:00Z',
      },
      registry,
    );
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.value.zone).toBe('hallway');
    expect(result.value.kind).toBe('motion');
    expect(result.value.at).toBe(Date.parse('2026-09-10T07:35:00Z'));
  });

  it('maps a contact sensor opening to door_open', () => {
    // The scope that makes door_open real. Camera motion alone cannot tell us a
    // door was physically opened, which is the strongest occupancy signal there is.
    const result = adaptActivityEvent(
      { eventType: 'contact_open', deviceId: 'dev-front-contact', occurredAt: 1_757_492_100_000 },
      registry,
    );
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.value.kind).toBe('door_open');
  });

  it('accepts epoch milliseconds as well as ISO strings', () => {
    const result = adaptActivityEvent(
      { eventType: 'motion', deviceId: 'dev-kitchen', occurredAt: 1_757_492_100_000 },
      registry,
    );
    expect(result.outcome).toBe('ok');
  });

  it('synthesises a stable id when Ring does not supply one', () => {
    const payload = { eventType: 'motion', deviceId: 'dev-kitchen', occurredAt: 1_757_492_100_000 };
    const first = adaptActivityEvent(payload, registry);
    const second = adaptActivityEvent(payload, registry);
    expect(first.outcome).toBe('ok');
    if (first.outcome !== 'ok' || second.outcome !== 'ok') return;
    // Deduplication depends on this: Ring retries webhooks, and a replayed event
    // must not look like a second visit to the kitchen.
    expect(first.value.id).toBe(second.value.id);
  });

  it('ignores a device nobody has placed in a zone', () => {
    // Ring did its job; the household just has an unplaced camera. Inventing a
    // zone would be worse than declining, because a wrong zone silently corrupts
    // the interior/exterior distinction the whole model rests on.
    const result = adaptActivityEvent(
      { eventType: 'motion', deviceId: 'dev-unknown', occurredAt: 1_757_492_100_000 },
      registry,
    );
    expect(result.outcome).toBe('ignored');
  });

  it('ignores events we expect but do not use', () => {
    for (const eventType of ['contact_closed', 'subscription_changed', 'livestream_started']) {
      const result = adaptActivityEvent(
        { eventType, deviceId: 'dev-hallway', occurredAt: 1 },
        registry,
      );
      expect(result.outcome, eventType).toBe('ignored');
    }
  });

  it('reports an unrecognised event type as invalid', () => {
    const result = adaptActivityEvent(
      { eventType: 'quantum_tunnelling_detected', deviceId: 'dev-hallway', occurredAt: 1 },
      registry,
    );
    expect(result.outcome).toBe('invalid');
  });

  it('lists the keys it found when the shape is wrong', () => {
    // This is the whole point of being strict. The first real webhook that fails
    // should hand us Ring's actual field names, not a shrug.
    const result = adaptActivityEvent(
      { kind: 'motion', device: 'dev-hallway', timestamp: 'now' },
      registry,
    );
    expect(result.outcome).toBe('invalid');
    if (result.outcome !== 'invalid') return;
    expect(result.reason).toContain('kind');
    expect(result.reason).toContain('device');
    expect(result.reason).toContain('timestamp');
  });

  it('rejects non-objects without throwing', () => {
    for (const payload of [null, undefined, 'motion', 42, []]) {
      expect(() => adaptActivityEvent(payload, registry)).not.toThrow();
    }
  });
});

describe('device health', () => {
  it('reads an offline event as not observable', () => {
    const result = adaptDeviceHealth(
      { eventType: 'device_offline', deviceId: 'dev-kitchen', occurredAt: 1_757_492_100_000 },
      registry,
    );
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.value.online).toBe(false);
    expect(result.value.zone).toBe('kitchen');
  });

  it('reads an online event as observable', () => {
    const result = adaptDeviceHealth(
      { eventType: 'device_online', deviceId: 'dev-kitchen', occurredAt: 1 },
      registry,
    );
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.value.online).toBe(true);
  });

  it('treats an ambiguous status as offline', () => {
    // Fail safe. Believing a camera is watching when it is not is what turns a
    // blind spot into a false welfare alert about a person who is perfectly fine.
    const result = adaptDeviceHealth(
      { eventType: 'device_status', deviceId: 'dev-kitchen', occurredAt: 1 },
      registry,
    );
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.value.online).toBe(false);
  });

  it('carries battery level through when present', () => {
    const result = adaptDeviceHealth(
      {
        eventType: 'device_offline',
        deviceId: 'dev-front',
        occurredAt: 1,
        batteryPercent: 0,
      },
      registry,
    );
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.value.batteryPercent).toBe(0);
  });

  it('ignores activity events handed to the wrong adapter', () => {
    const result = adaptDeviceHealth(
      { eventType: 'motion', deviceId: 'dev-hallway', occurredAt: 1 },
      registry,
    );
    expect(result.outcome).toBe('ignored');
  });
});

describe('device registry', () => {
  it('flags devices that need placing', () => {
    const discovered = ['dev-hallway', 'dev-landing', 'dev-shed'];
    expect(unmappedDevices(registry, discovered)).toEqual(['dev-landing', 'dev-shed']);
  });
});
