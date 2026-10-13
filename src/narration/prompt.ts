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
- One time reference is enough. Do not repeat a duration for every item, do not quote minute counts, and do not write "respectively" — this is a message to a worried person, not a report.
- If several things are outstanding, name them in passing rather than itemising them.

Good: "No sign of Margaret being up yet today — usually by 08:20, and it's now 11:24. The kitchen and hallway are quiet too."
Bad: "At 11:24, first activity is 184 minutes overdue. Hallway activity is 177 minutes overdue and kitchen activity is 145 minutes overdue, respectively."

Think of the tone as a neighbour mentioning something in passing, not an alarm going off.`;

/** "about two hours later than usual" — how a person would say it. */
export function spokenLateness(minutes: number): string {
  if (minutes < 45) return 'a little later than usual';
  if (minutes < 75) return 'about an hour later than usual';
  const hours = Math.round(minutes / 60);
  const words = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  return `about ${words[hours] ?? hours} hours later than usual`;
}

export function buildUserPrompt(request: NarrationRequest): string {
  const who = request.residentName ?? 'the resident';
  const lines = [
    `Current local time: ${request.localTime}`,
    `Person: ${who}`,
    `Assessed severity: ${request.severity}`,
    '',
    'Verified facts, most overdue first:',
  ];

  // Not having been seen at all is the headline, whatever else is late.
  const ordered = [...request.findings].sort((a, b) => {
    if (a.anchorKey === 'first_activity') return -1;
    if (b.anchorKey === 'first_activity') return 1;
    return b.minutesOverdue - a.minutesOverdue;
  });

  // The model is given the usual time and a spoken lateness, never the deadline or a
  // raw minute count. Given "expected by 08:27, 243 minutes overdue" it repeated both
  // — calling the deadline "usual" and quoting minutes — regardless of instructions.
  // It cannot repeat what it is not shown.
  for (const finding of ordered) {
    lines.push(
      `- ${finding.label}: usually by ${formatMinute(finding.medianMinute)}; ` +
        `not seen yet; ${spokenLateness(finding.minutesOverdue)}.`,
    );
  }

  lines.push(
    '',
    'Write the notification. Lead with the first item. Use its usual time and the current time. Name the others in passing, without times.',
  );

  return lines.join('\n');
}
