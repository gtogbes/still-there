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

describe('consent withdrawal', () => {
  it('recognises a removed integration as a revocation', () => {
    const result = classifyRingPayload(webhook('app_integration_removed'), registry);
    expect(result.kind).toBe('revocation');
    if (result.kind !== 'revocation') return;
    expect(result.revocation.accountId).toBe('acct');
  });

  it('honours a revocation even for a device nobody mapped', () => {
    // A revocation is about the account, not a device. Refusing to erase somebody's
    // data because a camera was never assigned to a room would be an absurd reason
    // to keep it.
    const result = classifyRingPayload(
      webhook('app_integration_removed', 'dev-never-placed'),
      registry,
    );
    expect(result.kind).toBe('revocation');
  });

  it('refuses a revocation with no account id rather than guessing', () => {
    // Erasure is destructive and irreversible. Without knowing whose data to remove,
    // acting anyway would mean deleting the wrong household's history.
    const anonymous = {
      meta: { version: '1.1', time: '2026-09-25T10:00:00Z', request_id: 'r' },
      data: {
        id: 'e',
        type: 'app_integration_removed',
        attributes: { source: 'dev-hallway', source_type: 'devices', timestamp: 1 },
      },
    };
    const result = classifyRingPayload(anonymous, registry);
    expect(result.kind).toBe('uninterpretable');
  });

  it('does not treat a lapsed subscription as consent withdrawal', () => {
    // subscription_deactivated means stop calling the API, not erase the household.
    // Ring restores access on resubscription, so deleting a movement history over a
    // missed payment would be destroying data the user never asked us to destroy.
    const result = classifyRingPayload(webhook('subscription_deactivated'), registry);
    expect(result.kind).toBe('ignored');
  });
});
