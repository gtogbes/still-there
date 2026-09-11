import { describe, expect, it } from 'vitest';
import { learnBaseline } from '../src/domain/baseline.js';
import { assess, blindSpots, deviations } from '../src/domain/deviation.js';
import { fromLocal } from '../src/domain/time.js';
import { blindSnapshot, eventsOnDate, generateHistory, healthySnapshot } from '../src/testing/generator.js';
import { ese } from '../src/testing/personas.js';
import type { Finding } from '../src/domain/types.js';

/**
 * Safety invariants on the text we put in front of a human.
 *
 * These are not style checks. This alert lands on someone's phone while they are
 * at work and cannot get to their mother, and the difference between "no kitchen
 * activity yet, usually by 09:00" and "she may have fallen" is the difference
 * between a useful nudge and a panic attack over a woman who went out early.
 *
 * The wording is generated deterministically for exactly this reason. A language
 * model will later choose tone and ordering, but it is never allowed to originate
 * a claim about what the cameras saw — these tests pin the layer it builds on.
 */

const FORBIDDEN_SPECULATION = [
  'fall',
  'fallen',
  'collapse',
  'unconscious',
  'stroke',
  'heart attack',
  'injured',
  'unwell',
  'ill',
  'emergency',
  'died',
  'dead',
  'dying',
  'hospital',
  'medical',
  'diagnos',
];

const START = '2026-06-01';
const TEST_DAY = '2026-07-13';
const TZ = ese.config.timeZone;
const noon = fromLocal(TEST_DAY, 12 * 60, TZ);

const baseline = learnBaseline(
  generateHistory(ese, { startDateKey: START, days: 42, seed: 1 }),
  ese.config,
);

const deadDayEvents = eventsOnDate(
  generateHistory(ese, { startDateKey: TEST_DAY, days: 1, seed: 501, omit: () => true }),
  TEST_DAY,
  TZ,
);

function findingsWith(health: Parameters<typeof assess>[0]['health']): readonly Finding[] {
  return assess({
    baseline,
    config: ese.config,
    todaysEvents: deadDayEvents,
    health,
    evaluatedAt: noon,
  }).findings;
}

describe('what an alert is allowed to say', () => {
  const observed = findingsWith(healthySnapshot(ese, noon));
  const blind = findingsWith(blindSnapshot(ese, noon, 'offline'));
  const all = [...observed, ...blind];

  it('produces something to check', () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it('never speculates about cause, health, or injury', () => {
    for (const finding of all) {
      const text = finding.reason.toLowerCase();
      for (const word of FORBIDDEN_SPECULATION) {
        expect(text, `"${finding.reason}" must not contain "${word}"`).not.toContain(word);
      }
    }
  });

  it('always names the habit and the time it was expected', () => {
    // "Unusual activity detected" is the alert people learn to ignore. Every
    // finding has to carry the specific missed habit and a clock time.
    for (const finding of all) {
      expect(finding.reason).toMatch(/\d{2}:\d{2}/);
      expect(finding.reason.toLowerCase()).toContain(finding.label.toLowerCase());
    }
  });

  it('never claims footage was viewed', () => {
    // Imagery is only fetched on escalation, and this layer never fetches it. If
    // the wording ever implies otherwise, the privacy promise is broken.
    for (const finding of all) {
      const text = finding.reason.toLowerCase();
      expect(text).not.toContain('footage');
      expect(text).not.toContain('video');
      expect(text).not.toContain('i can see');
      expect(text).not.toContain('in the image');
    }
  });
});

describe('blind spots are maintenance, not emergencies', () => {
  const blind = blindSpots(
    assess({
      baseline,
      config: ese.config,
      todaysEvents: deadDayEvents,
      health: blindSnapshot(ese, noon, 'offline'),
      evaluatedAt: noon,
    }),
  );

  it('produces blind-spot findings for this fixture', () => {
    expect(blind.length).toBeGreaterThan(0);
  });

  it('never escalates something we could not see', () => {
    for (const finding of blind) {
      expect(finding.severity).toBe('low');
    }
  });

  it('says it cannot confirm, rather than asserting nothing happened', () => {
    for (const finding of blind) {
      expect(finding.reason).toContain('Cannot confirm');
      expect(finding.reason.toLowerCase()).not.toMatch(/^no /);
    }
  });
});

describe('observed deviations state the absence plainly', () => {
  const found = deviations(
    assess({
      baseline,
      config: ese.config,
      todaysEvents: deadDayEvents,
      health: healthySnapshot(ese, noon),
      evaluatedAt: noon,
    }),
  );

  it('produces deviation findings for this fixture', () => {
    expect(found.length).toBeGreaterThan(0);
  });

  it('quantifies how confident the habit is', () => {
    // Showing "seen on 30 of the last 30 working days" is what lets a family
    // judge the alert for themselves instead of trusting a black box.
    for (const finding of found) {
      expect(finding.reason).toMatch(/seen on \d+ of the last \d+/);
    }
  });
});
