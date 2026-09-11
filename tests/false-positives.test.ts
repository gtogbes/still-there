import { describe, expect, it } from 'vitest';
import { learnBaseline } from '../src/domain/baseline.js';
import { assess, deviations } from '../src/domain/deviation.js';
import { addDays, fromLocal } from '../src/domain/time.js';
import { eventsOnDate, generateHistory, healthySnapshot } from '../src/testing/generator.js';
import { nosa, ese } from '../src/testing/personas.js';
import type { Persona } from '../src/testing/personas.js';

/**
 * The false-positive budget.
 *
 * We are claiming, in a submission, that this system beats alert fatigue. That
 * claim needs a number behind it, measured the same way every run, or it is just
 * a nice sentence. So: learn a baseline, then live through sixty ordinary days
 * where nothing whatsoever is wrong, check in four times a day, and count how
 * often the system bothers the family for no reason.
 *
 * Treated as an error budget rather than a pass/fail: a caretaking product that
 * nudges once a month is fine, one that nudges twice a week gets muted and then
 * misses the day that mattered.
 */

const LEARNING_START = '2026-06-01';
const LEARNING_DAYS = 42;
const TRIAL_START = addDays(LEARNING_START, LEARNING_DAYS);
const TRIAL_DAYS = 60;
const CHECK_IN_MINUTES = [10 * 60, 13 * 60, 17 * 60, 20 * 60];

export interface Measurement {
  readonly trialDays: number;
  readonly daysWithAlert: number;
  readonly totalCheckIns: number;
  readonly alertingCheckIns: number;
  /** Unnecessary nudges per thirty days, the figure a family would feel. */
  readonly alertsPerThirtyDays: number;
}

function measureFalsePositives(persona: Persona, learnSeed: number, trialSeed: number): Measurement {
  const baseline = learnBaseline(
    generateHistory(persona, {
      startDateKey: LEARNING_START,
      days: LEARNING_DAYS,
      seed: learnSeed,
    }),
    persona.config,
  );

  const trial = generateHistory(persona, {
    startDateKey: TRIAL_START,
    days: TRIAL_DAYS,
    seed: trialSeed,
  });

  let daysWithAlert = 0;
  let alertingCheckIns = 0;
  let totalCheckIns = 0;

  for (let dayIndex = 0; dayIndex < TRIAL_DAYS; dayIndex += 1) {
    const dateKey = addDays(TRIAL_START, dayIndex);
    const todaysEvents = eventsOnDate(trial, dateKey, persona.config.timeZone);
    let alertedToday = false;

    for (const minute of CHECK_IN_MINUTES) {
      const evaluatedAt = fromLocal(dateKey, minute, persona.config.timeZone);
      totalCheckIns += 1;
      const assessment = assess({
        baseline,
        config: persona.config,
        todaysEvents,
        health: healthySnapshot(persona, evaluatedAt),
        evaluatedAt,
      });
      if (deviations(assessment).length > 0) {
        alertingCheckIns += 1;
        alertedToday = true;
      }
    }

    if (alertedToday) daysWithAlert += 1;
  }

  return {
    trialDays: TRIAL_DAYS,
    daysWithAlert,
    totalCheckIns,
    alertingCheckIns,
    alertsPerThirtyDays: (daysWithAlert / TRIAL_DAYS) * 30,
  };
}

/** A budget met by one lucky seed is not a budget. */
const SEEDS: readonly { readonly learn: number; readonly trial: number }[] = [
  { learn: 1, trial: 2 },
  { learn: 11, trial: 12 },
  { learn: 21, trial: 22 },
];

const NOSA_SEEDS: readonly { readonly learn: number; readonly trial: number }[] = [
  { learn: 7, trial: 8 },
  { learn: 17, trial: 18 },
  { learn: 27, trial: 28 },
];

/**
 * Measured on 2026-09-10 with three seeds each, 60 trial days, four check-ins a
 * day: Ese 0.00 per 30 days on every seed; Nosa 1.00, 1.00 and 1.50.
 *
 * Nosa's budget is deliberately non-zero. He keeps no real schedule, so a handful
 * of his days genuinely look like nothing happened, and pretending otherwise
 * would mean either inventing structure he does not have or widening tolerances
 * until the system never notices anything.
 */
const NOSA_BUDGET_PER_THIRTY_DAYS = 2;

describe('false-positive budget', () => {
  it.each(SEEDS)(
    'never bothers a regular household without cause (seeds $learn/$trial)',
    ({ learn, trial }) => {
      const measured = measureFalsePositives(ese, learn, trial);
      expect(measured.totalCheckIns).toBe(TRIAL_DAYS * CHECK_IN_MINUTES.length);
      expect(
        measured.daysWithAlert,
        `Ese: ${measured.daysWithAlert} of ${measured.trialDays} ordinary days produced an alert`,
      ).toBe(0);
    },
  );

  it.each(NOSA_SEEDS)(
    'stays within budget for an irregular household (seeds $learn/$trial)',
    ({ learn, trial }) => {
      const measured = measureFalsePositives(nosa, learn, trial);
      expect(
        measured.alertsPerThirtyDays,
        `Nosa: ${measured.alertsPerThirtyDays.toFixed(2)} alerts per 30 days (${measured.daysWithAlert}/${measured.trialDays} days)`,
      ).toBeLessThanOrEqual(NOSA_BUDGET_PER_THIRTY_DAYS);
    },
  );

  it('keeps watching something even for the irregular household', () => {
    // The cheap way to hit a false-positive budget is to learn nothing and stay
    // silent forever. Guard against that: Nosa must still have anchors, so the
    // budget is being met by good judgement rather than by giving up.
    const baseline = learnBaseline(
      generateHistory(nosa, { startDateKey: LEARNING_START, days: LEARNING_DAYS, seed: 7 }),
      nosa.config,
    );
    expect(baseline.anchors.length).toBeGreaterThan(0);
    expect(baseline.anchors.some((anchor) => anchor.key === 'first_activity')).toBe(true);
  });
});
