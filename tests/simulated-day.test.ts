import { describe, expect, it } from 'vitest';
import { learnBaseline } from '../src/domain/baseline.js';
import { assess, deviations, blindSpots } from '../src/domain/deviation.js';
import { addDays, fromLocal, localParts } from '../src/domain/time.js';
import { HISTORY_DAYS, SCRIPTED_MOMENTS, simulatedDay } from '../src/demo/simulated-day.js';
import { jasmine } from '../src/testing/personas.js';

/**
 * The simulated household has to tell the same story on any day of the judging
 * window. These pin that: a full baseline, a morning that did not happen, cameras
 * that count as watching at any time today, and a severity that climbs across the
 * three scripted moments.
 */

const tz = jasmine.config.timeZone;
// A date inside the judging window, at three in the morning.
const now = fromLocal('2026-11-12', 3 * 60, tz);

describe('the simulated day', () => {
  const day = simulatedDay(jasmine, now);
  const todayStart = fromLocal(day.today, 0, tz);
  const history = day.events.filter((e) => e.at < todayStart);
  const today = day.events.filter((e) => e.at >= todayStart);

  it('is for the local date of the moment it runs', () => {
    expect(day.today).toBe('2026-11-12');
    expect(day.replaceUntil).toBe(fromLocal('2026-11-13', 0, tz));
  });

  it('carries six weeks of history ending yesterday', () => {
    const dates = new Set(history.map((e) => localParts(e.at, tz).dateKey));
    expect(dates.size).toBe(HISTORY_DAYS);
    expect(dates.has(addDays(day.today, -1))).toBe(true);
    expect(dates.has(addDays(day.today, -HISTORY_DAYS))).toBe(true);
    expect(history.every((e) => e.at >= day.replaceFrom)).toBe(true);
  });

  it('has nobody up indoors today: only the street, and the cat', () => {
    expect(today.length).toBeGreaterThan(0);
    const personIndoors = today.filter(
      (e) => jasmine.config.interiorZones.includes(e.zone) && e.subject !== 'other',
    );
    expect(personIndoors).toEqual([]);
    expect(today.some((e) => e.kind === 'door_open')).toBe(false);
  });

  it('keeps every camera watching even with the clock moved past real time', () => {
    const lunchtime = fromLocal(day.today, 12 * 60 + 30, tz);
    const result = assess({
      baseline: learnBaseline(history, jasmine.config),
      config: jasmine.config,
      todaysEvents: today,
      health: day.health,
      evaluatedAt: lunchtime,
      suppressions: [],
    });
    expect(blindSpots(result)).toHaveLength(0);
    expect(deviations(result).length).toBeGreaterThan(0);
  });

  it('escalates across the three scripted moments', () => {
    const baseline = learnBaseline(history, jasmine.config);
    const rank = { low: 1, medium: 2, high: 3 } as const;
    const peaks = SCRIPTED_MOMENTS.map((minute) => {
      const result = assess({
        baseline,
        config: jasmine.config,
        todaysEvents: today,
        health: day.health,
        evaluatedAt: fromLocal(day.today, minute, tz),
        suppressions: [],
      });
      return Math.max(...deviations(result).map((d) => rank[d.severity]));
    });
    expect(peaks).toEqual([1, 2, 3]);
  });

  it('is deterministic for a given date', () => {
    const again = simulatedDay(jasmine, now + 60 * 60_000);
    expect(again.events).toEqual(day.events);
  });
});
