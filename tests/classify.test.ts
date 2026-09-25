import { describe, expect, it } from 'vitest';
import { classifyRingPayload } from '../src/ring/classify.js';
import { buildDeviceRegistry } from '../src/ring/devices.js';

const registry = buildDeviceRegistry({ 'dev-hallway': 'hallway' });

function webhook(type: string, deviceId = 'dev-hallway', extra: Record<string, unknown> = {}) {
  return {
    meta: { version: '1.1', time: '2026-09-25T10:00:00Z', request_id: 'req-1', account_id: 'acct' },
    data: {
      id: 'evt-1',
      type,
      ...extra,
      attributes: { source: deviceId, source_type: 'devices', timestamp: 1_790_000_000_000 },
    },
  };
}

describe('classifying an inbound payload', () => {
  it('recognises activity', () => {
    const result = classifyRingPayload(webhook('motion_detected', 'dev-hallway', { subType: 'human' }), registry);
    expect(result.kind).toBe('activity');
    if (result.kind !== 'activity') return;
    expect(result.activity.event.subject).toBe('human');
  });

  it('recognises device status', () => {
    const result = classifyRingPayload(webhook('device_offline'), registry);
    expect(result.kind).toBe('health');
    if (result.kind !== 'health') return;
    expect(result.health.sample.online).toBe(false);
  });

  it('reports an unknown event type as uninterpretable, not ignored', () => {
    // The regression. This returned 'ignored' in production because the health
    // adapter's "not a status event" verdict masked the activity adapter's
    // 'invalid', so unreadable payloads vanished silently instead of alerting.
    const result = classifyRingPayload(webhook('quantum_tunnelling'), registry);
    expect(result.kind).toBe('uninterpretable');
  });

  it('reports a wrong-shaped payload as uninterpretable', () => {
    const flat = { eventType: 'motion', deviceId: 'dev-hallway', occurredAt: 1 };
    expect(classifyRingPayload(flat, registry).kind).toBe('uninterpretable');
  });

  it('still ignores events we understand and do not use', () => {
    for (const type of ['subscription_activated', 'device_added', 'tamper_cleared']) {
      expect(classifyRingPayload(webhook(type), registry).kind, type).toBe('ignored');
    }
  });

  it('records a door closing as activity, leaving occupancy to judge it', () => {
    // Two separate decisions, easy to conflate. Classification asks "is this a
    // real event we should write down", and a door closing is. Occupancy asks "is
    // this proof somebody is up", and a door that swung shut is not. Keeping them
    // apart means the closing is still available as context without ever being
    // mistaken for evidence of life.
    const result = classifyRingPayload(webhook('contact_sensor_cleared'), registry);
    expect(result.kind).toBe('activity');
    if (result.kind !== 'activity') return;
    expect(result.activity.event.kind).toBe('door_closed');
  });

  it('ignores an unmapped device rather than calling it unreadable', () => {
    // Ring did nothing wrong; the household has a device nobody has placed. That
    // is a setup gap, not a protocol failure, and must not page anyone.
    const result = classifyRingPayload(webhook('motion_detected', 'dev-unplaced'), registry);
    expect(result.kind).toBe('ignored');
  });

  it('never throws on rubbish', () => {
    for (const payload of [null, undefined, 42, 'motion', [], {}]) {
      expect(() => classifyRingPayload(payload, registry)).not.toThrow();
      expect(classifyRingPayload(payload, registry).kind).toBe('uninterpretable');
    }
  });
});
