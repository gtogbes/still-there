import { describe, expect, it } from 'vitest';
import { learnBaseline } from '../src/domain/baseline.js';
import { assess, blindSpots, deviations, peakSeverity } from '../src/domain/deviation.js';
import { fromLocal } from '../src/domain/time.js';
import { blindSnapshot, eventsOnDate, generateHistory, healthySnapshot } from '../src/testing/generator.js';
import { ese } from '../src/testing/personas.js';

const START = '2026-06-01';
const LEARNING_DAYS = 42;
const TEST_DAY = '2026-07-13';
const TZ = ese.config.timeZone;

const baseline = learnBaseline(
  generateHistory(ese, { startDateKey: START, days: LEARNING_DAYS, seed: 1 }),
  ese.config,
);

function dayEvents(options: { seed: number; omit?: Parameters<typeof generateHistory>[1]['omit'] }) {
  const generated = generateHistory(ese, {
    startDateKey: TEST_DAY,
    days: 1,
    seed: options.seed,
    ...(options.omit === undefined ? {} : { omit: options.omit }),
  });
  return eventsOnDate(generated, TEST_DAY, TZ);
}

const noon = fromLocal(TEST_DAY, 12 * 60, TZ);

describe('a normal day', () => {
  it('says nothing at all', () => {
    // The most important test in the suite. Silence on a normal day is the
    // product; anything else is noise the family will eventually mute.
    const assessment = assess({
      baseline,
      config: ese.config,
      todaysEvents: dayEvents({ seed: 101 }),
      health: healthySnapshot(ese, noon),
      evaluatedAt: noon,
    });
    expect(assessment.findings).toHaveLength(0);
    expect(peakSeverity(assessment)).toBeNull();
  });

  it('stays quiet before a habit is actually due', () => {
    const early = fromLocal(TEST_DAY, 7 * 60, TZ);
    const assessment = assess({
      baseline,
      config: ese.config,
      todaysEvents: dayEvents({ seed: 102, omit: () => true }),
      health: healthySnapshot(ese, early),
      evaluatedAt: early,
    });
    // Nothing has happened yet, but nothing was expected yet either.
    expect(assessment.findings).toHaveLength(0);
  });
});

describe('a day where the routine does not happen', () => {
  const events = dayEvents({ seed: 201, omit: () => true });

  it('still contains street activity, which must not paper over the silence', () => {
    // Guard on the fixture itself: if the generator stopped producing ambient
    // events this test would pass for the wrong reason.
    expect(events.some((event) => event.zone === 'front_door')).toBe(true);
    expect(events.every((event) => event.kind !== 'door_open')).toBe(true);
  });

  it('notices, and says which habit was missed', () => {
    const assessment = assess({
      baseline,
      config: ese.config,
      todaysEvents: events,
      health: healthySnapshot(ese, noon),
      evaluatedAt: noon,
    });

    const found = deviations(assessment);
    expect(found.length).toBeGreaterThan(0);
    expect(found.map((f) => f.anchorKey)).toContain('first_activity');
    expect(peakSeverity(assessment)).toBe('high');
  });

  it('escalates as the day wears on', () => {
    const measure = (minute: number): number => {
      const at = fromLocal(TEST_DAY, minute, TZ);
      const assessment = assess({
        baseline,
        config: ese.config,
        todaysEvents: events,
        health: healthySnapshot(ese, at),
        evaluatedAt: at,
      });
      const first = deviations(assessment).find((f) => f.anchorKey === 'first_activity');
      return first?.minutesOverdue ?? -1;
    };
    expect(measure(9 * 60)).toBeLessThan(measure(12 * 60));
  });
});

describe('telling a blind spot apart from a welfare problem', () => {
  const events = dayEvents({ seed: 301, omit: () => true });

  it('reports what it cannot see rather than what it thinks happened', () => {
    // Identical event stream to the alarming case above. The only difference is
    // that the cameras were not watching, and that must change the answer.
    const assessment = assess({
      baseline,
      config: ese.config,
      todaysEvents: events,
      health: blindSnapshot(ese, noon, 'offline'),
      evaluatedAt: noon,
    });

    expect(deviations(assessment)).toHaveLength(0);
    expect(blindSpots(assessment).length).toBeGreaterThan(0);
  });

  it('does not trust a device that claims to be online but stopped reporting', () => {
    // The nastiest failure mode: online === true, telemetry four hours stale. A
    // naive check believes it and raises a welfare alert about a house it has not
    // heard from since breakfast.
    const assessment = assess({
      baseline,
      config: ese.config,
      todaysEvents: events,
      health: blindSnapshot(ese, noon, 'stale'),
      evaluatedAt: noon,
    });
    expect(deviations(assessment)).toHaveLength(0);
    expect(blindSpots(assessment).length).toBeGreaterThan(0);
  });

  it('mentions a flat battery when that is the cause', () => {
    const assessment = assess({
      baseline,
      config: ese.config,
      todaysEvents: events,
      health: blindSnapshot(ese, noon, 'flat_battery'),
      evaluatedAt: noon,
    });
    expect(blindSpots(assessment).some((f) => f.reason.includes('flat battery'))).toBe(true);
  });

  it('isolates a single dead camera without going blind everywhere', () => {
    const partial = dayEvents({
      seed: 302,
      omit: ({ step }) => step.zone === 'kitchen' && step.atMinute < 10 * 60,
    });
    const assessment = assess({
      baseline,
      config: ese.config,
      todaysEvents: partial,
      health: blindSnapshot(ese, noon, 'stale', ['kitchen']),
      evaluatedAt: noon,
    });

    expect(deviations(assessment)).toHaveLength(0);
    const blind = blindSpots(assessment);
    expect(blind).toHaveLength(1);
    expect(blind[0]?.zone).toBe('kitchen');
  });
});

describe('when not to speak', () => {
  it('says nothing during the night', () => {
    const at = fromLocal(TEST_DAY, 3 * 60, TZ);
    const assessment = assess({
      baseline,
      config: ese.config,
      todaysEvents: dayEvents({ seed: 401, omit: () => true }),
      health: healthySnapshot(ese, at),
      evaluatedAt: at,
    });
    expect(assessment.suppressed).toBe(true);
    expect(assessment.findings).toHaveLength(0);
  });

  it('honours an away window instead of crying wolf for a fortnight', () => {
    const assessment = assess({
      baseline,
      config: ese.config,
      todaysEvents: dayEvents({ seed: 402, omit: () => true }),
      health: healthySnapshot(ese, noon),
      evaluatedAt: noon,
      suppressions: [
        { from: noon - 86_400_000, to: noon + 86_400_000, reason: 'away visiting family' },
      ],
    });
    expect(assessment.suppressed).toBe(true);
    expect(assessment.suppressionReason).toBe('away visiting family');
    expect(assessment.findings).toHaveLength(0);
  });
});
