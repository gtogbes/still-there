import { describe, expect, it } from 'vitest';
import { fallbackNarration, validateNarration } from '../src/narration/validate.js';
import { buildUserPrompt, SYSTEM_PROMPT } from '../src/narration/prompt.js';
import type { Finding } from '../src/domain/types.js';

/**
 * Tests for the layer that stands between a language model and a worried person.
 *
 * A model cannot be tested into never saying the wrong thing. So it is not trusted:
 * its output is a proposal, and these rules decide whether the proposal is sent or
 * quietly replaced with text we generated ourselves.
 */

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  type: 'deviation',
  anchorKey: 'activity:kitchen:motion',
  label: 'activity in the kitchen',
  zone: 'kitchen',
  expectedByMinute: 9 * 60,
  evaluatedAtMinute: 11 * 60 + 24,
  minutesOverdue: 144,
  presentDays: 30,
  observedDays: 30,
  severity: 'medium',
  reason:
    'No activity in the kitchen yet today. Usually by 08:11 (allowing until 09:14), seen on 30 of the last 30 working days. It is now 11:24, 144 minutes past.',
  ...overrides,
});

const findings = [finding()];

describe('accepting model output', () => {
  it('accepts a calm, specific message', () => {
    const text =
      "No activity in the kitchen yet today — usually by 09:00, and it's now 11:24. Might be worth a quick call.";
    expect(validateNarration(text, findings).acceptable).toBe(true);
  });
});

describe('rejecting model output', () => {
  it('rejects speculation about a fall', () => {
    // The exact sentence this whole layer exists to stop.
    const result = validateNarration(
      'No kitchen activity since 09:00. She may have had a fall — check on her.',
      findings,
    );
    expect(result.acceptable).toBe(false);
    expect(result.rejection).toContain('speculative');
  });

  it.each([
    ['medical framing', 'Kitchen inactive since 09:00, possible medical issue.'],
    ['urgency', 'Urgent: no kitchen activity since 09:00.'],
    ['emergency', 'Emergency — no kitchen activity since 09:00.'],
    ['illness', 'She seems unwell, no kitchen activity since 09:00.'],
  ])('rejects %s', (_label, text) => {
    expect(validateNarration(text, findings).acceptable).toBe(false);
  });

  it('rejects any claim that footage was seen', () => {
    // The privacy promise is that nothing is looked at unless a threshold trips.
    // A model casually writing "I can see" breaks it in the user's mind even if the
    // code never fetched an image.
    for (const text of [
      'I can see nobody has been in the kitchen since 09:00.',
      'The video shows no kitchen activity since 09:00.',
      'Nothing on camera in the kitchen since 09:00.',
    ]) {
      expect(validateNarration(text, findings).acceptable, text).toBe(false);
    }
  });

  it('rejects a message with no clock time', () => {
    // Without a time it has become "something seems off", which is exactly the
    // alert people learn to swipe away.
    const result = validateNarration(
      'There has been no activity in the kitchen for a while today.',
      findings,
    );
    expect(result.acceptable).toBe(false);
    expect(result.rejection).toContain('clock time');
  });

  it('rejects a fabricated habit', () => {
    // A model inventing a room it was never told about reads as entirely plausible,
    // which is what makes it dangerous. The message must reference something we
    // actually assessed.
    const result = validateNarration(
      'No movement in the bathroom yet today, usually by 09:00.',
      findings,
    );
    expect(result.acceptable).toBe(false);
    expect(result.rejection).toContain('assessed habit');
  });

  it('rejects an essay', () => {
    const text = `No activity in the kitchen yet today at 11:24. ${'Padding. '.repeat(90)}`;
    const result = validateNarration(text, findings);
    expect(result.acceptable).toBe(false);
    expect(result.rejection).toContain('too long');
  });

  it('rejects empty output', () => {
    expect(validateNarration('   ', findings).acceptable).toBe(false);
  });
});

describe('the fallback', () => {
  it('passes its own validator', () => {
    // Load-bearing. If the fallback could not satisfy the rules, a rejected model
    // response would leave us with nothing safe to send.
    const text = fallbackNarration(findings);
    expect(validateNarration(text, findings).acceptable).toBe(true);
  });

  it('leads with the most overdue finding', () => {
    const text = fallbackNarration([
      finding({ label: 'activity in the kitchen', minutesOverdue: 30 }),
      finding({
        anchorKey: 'first_activity',
        label: 'first sign of activity',
        minutesOverdue: 200,
        reason: 'No first sign of activity yet today. Usually by 07:31. It is now 11:24.',
      }),
    ]);
    expect(text.startsWith('No first sign of activity')).toBe(true);
  });

  it('summarises the rest rather than listing everything', () => {
    const many = [
      finding({ minutesOverdue: 200 }),
      finding({ anchorKey: 'a', minutesOverdue: 100 }),
      finding({ anchorKey: 'b', minutesOverdue: 50 }),
      finding({ anchorKey: 'c', minutesOverdue: 20 }),
    ];
    const text = fallbackNarration(many);
    expect(text).toContain('3 other usual activities');
  });

  it('names the single other outstanding item when there is only one', () => {
    const text = fallbackNarration([
      finding({ minutesOverdue: 200 }),
      finding({ anchorKey: 'x', label: 'activity in the hallway', minutesOverdue: 20 }),
    ]);
    expect(text).toContain('activity in the hallway');
  });

  it('returns nothing when there is nothing wrong', () => {
    expect(fallbackNarration([])).toBe('');
  });
});

describe('the prompt', () => {
  it('forbids speculation and imagery claims in the instructions', () => {
    // Belt as well as braces. The validator is what guarantees safety, but the
    // prompt should not be quietly asking for something the validator then blocks.
    const lower = SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain('never speculate');
    expect(lower).toContain('never imply');
  });

  it('gives the model facts and a writing job, not a judgement', () => {
    const prompt = buildUserPrompt({
      findings,
      severity: 'medium',
      localTime: '11:24',
      residentName: 'Ese',
    });
    expect(prompt).toContain('activity in the kitchen');
    expect(prompt).toContain('144 minutes overdue');
    expect(prompt).toContain('30 of the last 30');
    expect(prompt).toContain('Ese');
  });

  it('orders findings most overdue first', () => {
    const prompt = buildUserPrompt({
      findings: [
        finding({ label: 'activity in the kitchen', minutesOverdue: 30 }),
        finding({ label: 'first sign of activity', minutesOverdue: 200 }),
      ],
      severity: 'high',
      localTime: '11:24',
    });
    expect(prompt.indexOf('first sign of activity')).toBeLessThan(
      prompt.indexOf('activity in the kitchen'),
    );
  });
});
