import type { Finding } from '../domain/types.js';

/**
 * Validates what a language model produced before a human ever sees it.
 *
 * This is the load-bearing piece of the whole narration design. A model cannot be
 * unit-tested into never saying "she may have fallen" — prompting reduces the odds
 * and guarantees nothing. So the model's output is treated as a proposal, checked
 * against the same rules the deterministic text already satisfies, and discarded in
 * favour of that text if it fails.
 *
 * Which means the safety properties hold no matter what the model does, including
 * when it is having an off day, when the prompt gets edited carelessly, or when the
 * underlying model is swapped for a different one.
 */

/**
 * Words that speculate about cause, health or injury.
 *
 * The harm is specific. This message reaches someone at work who cannot get to their
 * mother for an hour. "No kitchen activity yet, usually by nine" lets them make a
 * judgement. "She may have fallen" produces an hour of panic over a woman who went
 * out early — and after one of those, the next alert gets ignored.
 */
const FORBIDDEN = [
  'fall',
  'fallen',
  'fell',
  'collapse',
  'unconscious',
  'stroke',
  'heart attack',
  'injur',
  'unwell',
  'emergency',
  'died',
  'dead',
  'dying',
  'hospital',
  'ambulance',
  'medical',
  'diagnos',
  'symptom',
  'urgent',
];

/** Phrases that would imply we looked at footage when we did not. */
const IMPLIES_IMAGERY = ['footage', 'video', 'i can see', 'in the image', 'on camera', 'recording'];

export interface ValidationResult {
  readonly acceptable: boolean;
  /** Present when rejected. Logged, never shown to a user. */
  readonly rejection?: string;
}

export function validateNarration(
  narration: string,
  findings: readonly Finding[],
): ValidationResult {
  const text = narration.trim();

  if (text === '') {
    return { acceptable: false, rejection: 'empty' };
  }

  // A notification is read on a lock screen. Anything this long has stopped being a
  // nudge and become something to deal with later, which defeats the purpose.
  if (text.length > 600) {
    return { acceptable: false, rejection: `too long (${text.length} chars)` };
  }

  const lower = text.toLowerCase();

  for (const word of FORBIDDEN) {
    if (lower.includes(word)) {
      return { acceptable: false, rejection: `speculative language: '${word}'` };
    }
  }

  for (const phrase of IMPLIES_IMAGERY) {
    if (lower.includes(phrase)) {
      return { acceptable: false, rejection: `implies imagery was viewed: '${phrase}'` };
    }
  }

  // Must carry a clock time. Without one it has degraded into "something seems off",
  // which is the alert people learn to swipe away.
  if (!/\d{1,2}:\d{2}/.test(text)) {
    return { acceptable: false, rejection: 'no clock time present' };
  }

  // Must refer to at least one habit we actually assessed. This is the check that
  // catches a fabricated finding — a model inventing a bathroom it was never told
  // about would otherwise read as perfectly plausible.
  const mentionsKnownHabit = findings.some((finding) => {
    const words = finding.label.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    return words.some((word) => lower.includes(word));
  });
  if (!mentionsKnownHabit) {
    return { acceptable: false, rejection: 'does not reference any assessed habit' };
  }

  return { acceptable: true };
}

/**
 * The message sent when the model is unavailable, denied, or produced something
 * unacceptable.
 *
 * Not a degraded mode so much as the floor. It is the same deterministic text the
 * domain layer generated, and it is already correct, specific and safe — the model
 * only ever makes it shorter and warmer.
 */
export function fallbackNarration(findings: readonly Finding[]): string {
  if (findings.length === 0) return '';

  const ordered = [...findings].sort((a, b) => b.minutesOverdue - a.minutesOverdue);
  const [first, ...rest] = ordered;
  if (first === undefined) return '';

  const lines = [first.reason];
  if (rest.length === 1) {
    lines.push(`One other usual activity is also outstanding: ${rest[0]?.label}.`);
  } else if (rest.length > 1) {
    lines.push(`${rest.length} other usual activities are also outstanding.`);
  }
  return lines.join(' ');
}
