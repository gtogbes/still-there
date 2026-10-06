import { describe, expect, it } from 'vitest';
import {
  buildSuppression,
  describeRoutine,
  describeSuppression,
  explainAssessment,
  householdStatus,
} from '../src/mcp/tools.js';
import { addDays, fromLocal, localParts } from '../src/domain/time.js';
import { eventsOnDate, generateHistory, healthySnapshot, blindSnapshot } from '../src/testing/generator.js';
import { ese } from '../src/testing/personas.js';
import type { StoredHousehold } from '../src/storage/household.js';
import type { Assessment } from '../src/domain/types.js';

/**
 * Tests for the spoken answers.
 *
 * These are read aloud by a voice assistant to somebody standing in a kitchen, so the
 * assertions are about what the sentences do and do not claim — not about formatting.
 * The one that matters most is the blind-spot case: when the cameras have stopped
 * reporting, "everything looks normal" would be the most dangerous sentence this
 * system could produce.
 */

const TZ = ese.config.timeZone;
const HISTORY_START = '2026-08-01';
const DAYS = 42;
const TODAY = addDays(HISTORY_START, DAYS);

const household: StoredHousehold = {
  ...ese.config,
  residentName: 'Ese',
  suppressions: [],
  updatedAt: 0,
};

const history = generateHistory(ese, { startDateKey: HISTORY_START, days: DAYS, seed: 5 });

function dayEvents(seed: number, broken: boolean) {
  return eventsOnDate(
    generateHistory(ese, {
      startDateKey: TODAY,
      days: 1,
      seed,
      ...(broken ? { omit: () => true } : {}),
    }),
    TODAY,
    TZ,
  );
}

const noon = fromLocal(TODAY, 12 * 60, TZ);

describe('still_there_status', () => {
  it('reassures on an ordinary day', () => {
    const { text } = householdStatus({
      household,
      historyEvents: history,
      todaysEvents: dayEvents(11, false),
      health: healthySnapshot(ese, noon),
      evaluatedAt: noon,
    });
    expect(text.toLowerCase()).toContain('normal day');
  });

  it('reports the missed habit, how late, and how dependable it was', () => {
    const { text } = householdStatus({
      household,
      historyEvents: history,
      todaysEvents: dayEvents(12, true),
      health: healthySnapshot(ese, noon),
      evaluatedAt: noon,
    });
    expect(text).toContain('Ese');
    expect(text).toMatch(/\d{1,2}:\d{2}/);
    expect(text).toMatch(/held on \d+ of the last \d+/);
  });

  it('never speculates about why', () => {
    const { text } = householdStatus({
      household,
      historyEvents: history,
      todaysEvents: dayEvents(13, true),
      health: healthySnapshot(ese, noon),
      evaluatedAt: noon,
    });
    const lower = text.toLowerCase();
    for (const word of ['fall', 'fallen', 'ill', 'unwell', 'hospital', 'emergency']) {
      expect(lower, `must not contain '${word}'`).not.toContain(word);
    }
  });

  it('refuses to reassure when the cameras were not watching', () => {
    // The most important sentence in this file. Same silence as the alarming case,
    // but nothing was observing it. Saying "normal day" here would be a lie, and
    // saying "she has not moved" would be a false alarm about somebody who is fine.
    const { text } = householdStatus({
      household,
      historyEvents: history,
      todaysEvents: dayEvents(14, true),
      health: blindSnapshot(ese, noon, 'stale'),
      evaluatedAt: noon,
    });
    expect(text).toContain("can't actually tell you");
    expect(text.toLowerCase()).not.toContain('normal day');
  });

  it('admits when it has not learned the routine yet', () => {
    const { text } = householdStatus({
      household,
      historyEvents: generateHistory(ese, { startDateKey: HISTORY_START, days: 3, seed: 9 }),
      todaysEvents: dayEvents(15, true),
      health: healthySnapshot(ese, noon),
      evaluatedAt: noon,
    });
    expect(text.toLowerCase()).toContain("don't know");
  });

  it('says nothing while monitoring is paused', () => {
    const paused: StoredHousehold = {
      ...household,
      suppressions: [{ from: noon - 86_400_000, to: noon + 86_400_000, reason: 'away in Lagos' }],
    };
    const { text } = householdStatus({
      household: paused,
      historyEvents: history,
      todaysEvents: dayEvents(16, true),
      health: healthySnapshot(ese, noon),
      evaluatedAt: noon,
    });
    expect(text).toContain('away in Lagos');
  });
});

describe('explain_last_alert', () => {
  it('recalls the habits, the expected times and the lateness', () => {
    const { assessment } = householdStatus({
      household,
      historyEvents: history,
      todaysEvents: dayEvents(21, true),
      health: healthySnapshot(ese, noon),
      evaluatedAt: noon,
    });

    const text = explainAssessment(assessment, TZ);
    expect(text).toMatch(/\d{1,2}:\d{2}/);
    expect(text).toContain('overdue');
    // The justification for keeping an audit trail at all: the answer explains the
    // threshold rather than just restating the alert.
    expect(text).toContain("household's own normal range");
  });

  it('is honest when nothing was sent', () => {
    expect(explainAssessment(undefined, TZ)).toContain("haven't sent you anything");
  });

  it('is honest when the last look found nothing', () => {
    const quiet: Assessment = {
      householdId: 'h',
      evaluatedAt: noon,
      dateKey: TODAY,
      dayClass: 'weekday',
      findings: [],
      suppressed: false,
    };
    expect(explainAssessment(quiet, TZ)).toContain("didn't contact you");
  });
});

describe('describe_routine', () => {
  it('lists the learned habits in order, and says they were learned', () => {
    const text = describeRoutine(household, history);
    expect(text).toContain('Ese');
    expect(text).toContain('learned from');
    // The reliability rule is the product's main defence against alert fatigue, so
    // it is worth a family hearing it rather than having to trust a black box.
    expect(text).toContain('nineteen days in twenty');
  });

  it('admits to not knowing yet rather than inventing a routine', () => {
    const text = describeRoutine(
      household,
      generateHistory(ese, { startDateKey: HISTORY_START, days: 2, seed: 3 }),
    );
    expect(text).toContain("haven't learned");
  });
});

describe('pause_monitoring', () => {
  it('builds a window of the requested length', () => {
    const window = buildSuppression(noon, 14, 'away visiting family');
    expect(window.to - window.from).toBe(14 * 86_400_000);
    expect(window.reason).toBe('away visiting family');
  });

  it('clamps absurd durations rather than accepting them', () => {
    // A voice interface will occasionally hear "three hundred days". Pausing a
    // welfare monitor for a year because of a mis-hear is not acceptable.
    expect(buildSuppression(noon, 5000, 'x').to - noon).toBe(90 * 86_400_000);
    expect(buildSuppression(noon, 0, 'x').to - noon).toBe(86_400_000);
  });

  it('falls back to a reason rather than storing an empty one', () => {
    expect(buildSuppression(noon, 3, '   ').reason).toBe('away');
  });

  it('confirms what it did, and that history is still being kept', () => {
    const text = describeSuppression(buildSuppression(noon, 7, 'in hospital'), TZ);
    expect(text).toContain('in hospital');
    expect(text).toContain(localParts(noon + 7 * 86_400_000, TZ).dateKey);
    // Important reassurance: pausing must not sound like it discards the routine,
    // or nobody will use it and the system will cry wolf through every holiday.
    expect(text).toContain("routine won't be forgotten");
  });
});
