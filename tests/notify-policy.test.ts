import { describe, expect, it } from 'vitest';
import { shouldNotify, type PriorNotification } from '../src/notify/policy.js';

const DAY = '2026-10-13';
const at = (hh: number, mm = 0) => Date.UTC(2026, 9, 13, hh, mm);

const sent = (hh: number, severity: PriorNotification['severity'], dateKey = DAY) => ({
  evaluatedAt: at(hh),
  dateKey,
  severity,
});

describe('when to contact the family', () => {
  it('stays silent when nothing is wrong', () => {
    expect(shouldNotify({ severity: null, dateKey: DAY, evaluatedAt: at(9), prior: [] }).send).toBe(false);
  });

  it('sends the first time something looks different today', () => {
    const decision = shouldNotify({ severity: 'low', dateKey: DAY, evaluatedAt: at(9), prior: [] });
    expect(decision).toEqual({ send: true, reason: 'first today' });
  });

  it('does not repeat itself every fifteen minutes', () => {
    // The bug this module exists to fix. Without it, a bad morning produced a
    // notification and a Bedrock call on every scheduled run.
    const decision = shouldNotify({
      severity: 'low',
      dateKey: DAY,
      evaluatedAt: at(9, 15),
      prior: [sent(9, 'low')],
    });
    expect(decision.send).toBe(false);
  });

  it('sends again when it gets worse', () => {
    const decision = shouldNotify({
      severity: 'medium',
      dateKey: DAY,
      evaluatedAt: at(10),
      prior: [sent(9, 'low')],
    });
    expect(decision).toEqual({ send: true, reason: 'escalated' });
  });

  it('caps a bad day at three messages', () => {
    const runs: { severity: 'low' | 'medium' | 'high'; hh: number; mm: number }[] = [];
    for (let minute = 8 * 60 + 30; minute <= 13 * 60; minute += 15) {
      const late = minute - (8 * 60 + 30);
      const severity = late < 60 ? 'low' : late < 180 ? 'medium' : 'high';
      runs.push({ severity, hh: Math.floor(minute / 60), mm: minute % 60 });
    }

    const prior: PriorNotification[] = [];
    for (const run of runs) {
      const decision = shouldNotify({
        severity: run.severity,
        dateKey: DAY,
        evaluatedAt: at(run.hh, run.mm),
        prior,
      });
      if (decision.send) prior.push({ evaluatedAt: at(run.hh, run.mm), dateKey: DAY, severity: run.severity });
    }

    expect(runs.length).toBeGreaterThan(15);
    expect(prior.map((p) => p.severity)).toEqual(['low', 'medium', 'high']);
  });

  it('ignores yesterday', () => {
    const decision = shouldNotify({
      severity: 'low',
      dateKey: DAY,
      evaluatedAt: at(9),
      prior: [sent(9, 'high', '2026-10-12')],
    });
    expect(decision.send).toBe(true);
  });

  it('in a live run, defers to a morning scripted in advance', () => {
    // The simulated household's three messages are produced at midnight. The real
    // 08:30 run must not send a fourth just because the 09:00 one is "later".
    const decision = shouldNotify({
      severity: 'low',
      dateKey: DAY,
      evaluatedAt: at(8, 30),
      prior: [sent(9, 'low'), sent(11, 'medium'), sent(12, 'high')],
      mode: 'live',
    });
    expect(decision.send).toBe(false);
  });

  it('in a live run, still sends when nothing has been recorded today', () => {
    const decision = shouldNotify({ severity: 'low', dateKey: DAY, evaluatedAt: at(8, 30), prior: [], mode: 'live' });
    expect(decision).toEqual({ send: true, reason: 'first today' });
  });

  it('ignores messages from later in the day when replaying an earlier moment', () => {
    const decision = shouldNotify({
      severity: 'low',
      dateKey: DAY,
      evaluatedAt: at(9),
      prior: [sent(12, 'high')],
    });
    expect(decision.send).toBe(true);
  });
});
