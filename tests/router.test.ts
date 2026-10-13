import { describe, expect, it } from 'vitest';
import { parseDays, routeByKeywords } from '../src/assistant/router.js';

const toolFor = (utterance: string) => {
  const route = routeByKeywords(utterance);
  return route.kind === 'tool' ? route.tool : `reply: ${route.text}`;
};

describe('fallback router', () => {
  it.each([
    ['Is Mum up yet?', 'still_there_status'],
    ['How is Jasmine today?', 'still_there_status'],
    ['Is everything alright?', 'still_there_status'],
    ['Why did you message me?', 'explain_last_alert'],
    ['What was that notification about?', 'explain_last_alert'],
    ["What's her normal day like?", 'describe_routine'],
    ['What do you watch for?', 'describe_routine'],
    ['She is away next week', 'pause_monitoring'],
    ["Mum's on holiday for 10 days", 'pause_monitoring'],
    ["She's back", 'resume_monitoring'],
    ["She's back from her trip", 'resume_monitoring'],
    ['Start watching again', 'resume_monitoring'],
  ])('routes "%s" to %s', (utterance, expected) => {
    expect(toolFor(utterance)).toBe(expected);
  });

  it('asks how long rather than guessing a pause length', () => {
    // Pausing a welfare monitor is the one consequential action here. Guessing the
    // duration would be the router taking a decision that belongs to the family.
    const route = routeByKeywords('She is going away');
    expect(route).toEqual({ kind: 'reply', text: 'How many days should I pause for?' });
  });

  it('treats a bare duration as the answer to that question', () => {
    const route = routeByKeywords('a week');
    expect(route).toEqual({ kind: 'tool', tool: 'pause_monitoring', args: { days: 7, reason: 'away' } });
  });

  it.each(['How is Jasmine today?', 'Is she up today?', 'Anything today?'])(
    'never pauses monitoring because "%s" mentions today',
    (utterance) => {
      // The regression. "today" used to parse as a one-day duration, so an ordinary
      // status question paused a welfare monitor.
      expect(toolFor(utterance)).not.toBe('pause_monitoring');
    },
  );

  it('offers help rather than guessing at something unrelated', () => {
    expect(routeByKeywords("What's the weather?").kind).toBe('reply');
  });

  it('records why the pause was asked for', () => {
    const route = routeByKeywords("She's on holiday for a fortnight");
    expect(route).toEqual({
      kind: 'tool',
      tool: 'pause_monitoring',
      args: { days: 14, reason: 'on holiday' },
    });
  });
});

describe('durations', () => {
  it.each([
    ['3 days', 3],
    ['2 weeks', 14],
    ['a week', 7],
    ['five days', 5],
    ['a couple of days', 2],
    ['a fortnight', 14],
    ['next week', 7],
    ['this weekend', 3],
    ['tonight', 1],
  ])('"%s" is %d days', (text, days) => {
    expect(parseDays(text)).toBe(days);
  });

  it('finds nothing when no duration is said', () => {
    expect(parseDays('she is going away')).toBeUndefined();
  });
});
