import { describe, expect, it } from 'vitest';
import { anchorsFor, learnBaseline } from '../src/domain/baseline.js';
import { generateHistory } from '../src/testing/generator.js';
import { nosa, ese } from '../src/testing/personas.js';

const START = '2026-06-01';
const DAYS = 42;

function eseBaseline() {
  const history = generateHistory(ese, { startDateKey: START, days: DAYS, seed: 1 });
  return learnBaseline(history, ese.config);
}

describe('learning a routine', () => {
  it('finds the habits a regular household actually keeps', () => {
    const baseline = eseBaseline();
    const keys = anchorsFor(baseline, 'weekday').map((anchor) => anchor.key);
    expect(keys).toContain('first_activity');
    expect(keys).toContain('activity:hallway:motion');
    expect(keys).toContain('activity:kitchen:motion');
    expect(keys).toContain('activity:front_door:door_open');
  });

  it('rejects a twice-weekly habit rather than alerting on it three times a week', () => {
    // Ese does laundry upstairs on Tuesdays and Fridays. That is 40% of
    // working days. Accepting it as an anchor would generate an unnecessary nudge
    // every Monday, Wednesday and Thursday — the exact behaviour that trains
    // families to ignore the alerts that matter.
    const baseline = eseBaseline();
    const keys = baseline.anchors.map((anchor) => anchor.key);
    expect(keys).not.toContain('activity:landing:motion');
  });

  it('ignores the street', () => {
    // Fourteen passers-by a day, six vehicles, a parcel. None of it is evidence
    // that Ese is up, so none of it may become an anchor.
    const baseline = eseBaseline();
    const keys = baseline.anchors.map((anchor) => anchor.key);
    expect(keys).not.toContain('activity:front_door:motion');
    expect(keys).not.toContain('activity:front_door:vehicle');
    expect(keys).not.toContain('activity:front_door:package');
  });

  it('learns weekdays and weekends separately', () => {
    const baseline = eseBaseline();
    expect(anchorsFor(baseline, 'weekday').length).toBeGreaterThan(0);
    expect(anchorsFor(baseline, 'weekend').length).toBeGreaterThan(0);
  });

  it('puts the first sign of activity in the morning, not at 3am', () => {
    // The night filter matters: without it a single trip to the bathroom becomes
    // "first activity" and drags the morning anchor back by hours, after which
    // the system never notices a missed morning again.
    const baseline = eseBaseline();
    const first = anchorsFor(baseline, 'weekday').find((a) => a.key === 'first_activity');
    expect(first).toBeDefined();
    expect(first?.medianMinute).toBeGreaterThan(7 * 60);
    expect(first?.medianMinute).toBeLessThan(8 * 60 + 30);
  });

  it('gives an irregular household wider tolerances than a regular one', () => {
    // Nosa keeps no real schedule. Whatever anchors survive must carry a much
    // larger spread, so the system is correspondingly slower to worry. Claiming
    // precision about someone this variable would be dishonest.
    const regular = eseBaseline();
    const irregular = learnBaseline(
      generateHistory(nosa, { startDateKey: START, days: DAYS, seed: 7 }),
      nosa.config,
    );

    const regularFirst = anchorsFor(regular, 'weekday').find((a) => a.key === 'first_activity');
    const irregularFirst = anchorsFor(irregular, 'weekday').find((a) => a.key === 'first_activity');
    expect(regularFirst).toBeDefined();
    expect(irregularFirst).toBeDefined();
    expect(irregularFirst!.madMinutes).toBeGreaterThan(regularFirst!.madMinutes);
  });

  it('refuses to learn anything from too short a window', () => {
    const history = generateHistory(ese, { startDateKey: START, days: 4, seed: 3 });
    const baseline = learnBaseline(history, ese.config);
    expect(baseline.anchors).toHaveLength(0);
  });
});
