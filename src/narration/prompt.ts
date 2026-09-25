import { formatMinute } from '../domain/time.js';
import type { Finding, Severity } from '../domain/types.js';

/**
 * Builds the prompt for the narration model.
 *
 * The model is given facts and a writing job, never a judgement. It is not asked
 * whether this is worrying, whether to notify anyone, or what might have happened —
 * all three were already decided deterministically. It is asked to turn four
 * accurate sentences into one that a worried person can absorb in five seconds.
 *
 * The instructions below are belt to the validator's braces. Prompting makes good
 * output likely; the validator is what makes bad output impossible to send.
 */

export interface NarrationRequest {
  readonly findings: readonly Finding[];
  readonly severity: Severity;
  /** What the resident is called, if the household set a name. */
  readonly residentName?: string;
  readonly localTime: string;
}

export const SYSTEM_PROMPT = `You write short notifications for a service that watches for missed daily routines in an older person's home, on behalf of a family member.

Your only job is rewriting. The decision to notify has already been made, and the facts you are given are already verified. Turn them into one short message.

Rules, without exception:
- Never speculate about why. You do not know, and guessing causes harm. Do not mention falls, illness, injury, hospitals, emergencies or anything medical.
- Never imply anyone looked at a camera image or video. Nobody has.
- Always keep at least one specific clock time from the facts.
- Always name the actual activity that was missed, using the words given to you. Never invent a room, an activity or a time.
- Two sentences at most. Under 300 characters.
- Calm and plain. You are prompting a phone call, not announcing a crisis.
- No greetings, no sign-off, no exclamation marks. Write it as the notification itself.

Think of the tone as a neighbour mentioning something in passing, not an alarm going off.`;

export function buildUserPrompt(request: NarrationRequest): string {
  const who = request.residentName ?? 'the resident';
  const lines = [
    `Current local time: ${request.localTime}`,
    `Person: ${who}`,
    `Assessed severity: ${request.severity}`,
    '',
    'Verified facts, most overdue first:',
  ];

  const ordered = [...request.findings].sort((a, b) => b.minutesOverdue - a.minutesOverdue);
  for (const finding of ordered) {
    lines.push(
      `- ${finding.label}: expected by ${formatMinute(finding.expectedByMinute)}, ` +
        `now ${finding.minutesOverdue} minutes overdue. ` +
        `Held on ${finding.presentDays} of the last ${finding.observedDays} comparable days.`,
    );
  }

  lines.push(
    '',
    'Write the notification. Lead with the most overdue item. If several are outstanding, summarise the rest in a few words rather than listing them.',
  );

  return lines.join('\n');
}
