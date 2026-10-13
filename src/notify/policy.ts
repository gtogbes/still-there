import type { Severity } from '../domain/types.js';

/**
 * When to contact the family, given what has already been sent today.
 *
 * The assessment runs every fifteen minutes. Without this policy a morning where
 * nobody got up would produce a message — and a Bedrock call — on every single run:
 * sixteen notifications by midday, all saying roughly the same thing. That is the
 * alert fatigue the whole product exists to avoid, and it costs money for nothing.
 *
 * The rule: one message the first time something looks different today, then one
 * more each time it gets materially worse. Severity has three levels, so a bad day
 * produces at most three messages:
 *
 *   low     "something looks different today"
 *   medium  "still nothing"
 *   high    "worth a call"
 *
 * A habit becoming overdue on its own does not trigger a new message. By the time
 * the kitchen is late, the family already knows the morning hasn't started.
 */

export interface PriorNotification {
  readonly evaluatedAt: number;
  readonly dateKey: string;
  readonly severity: Severity;
}

export type NotifyDecision =
  | { readonly send: true; readonly reason: 'first today' | 'escalated' }
  | { readonly send: false; readonly reason: string };

const RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

export function shouldNotify(input: {
  readonly severity: Severity | null;
  readonly dateKey: string;
  readonly evaluatedAt: number;
  readonly prior: readonly PriorNotification[];
  /**
   * 'replay' when an assessment is asked about a chosen moment, 'live' when it is
   * the scheduled run reading the real clock. Defaults to 'replay'.
   */
  readonly mode?: 'live' | 'replay';
}): NotifyDecision {
  if (input.severity === null) {
    return { send: false, reason: 'nothing to report' };
  }

  // Only today's messages. When replaying, only ones sent before this moment too: a
  // message recorded at 11:00 must not suppress one that would have gone at 09:30.
  //
  // A live run counts all of today. In normal operation that changes nothing, since
  // a record from later than now cannot exist. It exists only when a day was scripted
  // in advance — the simulated household, whose morning is produced at midnight —
  // and then the live run should defer to it rather than send a duplicate.
  const today = input.prior.filter(
    (p) =>
      p.dateKey === input.dateKey && (input.mode === 'live' || p.evaluatedAt < input.evaluatedAt),
  );

  if (today.length === 0) {
    return { send: true, reason: 'first today' };
  }

  const highest = Math.max(...today.map((p) => RANK[p.severity]));
  if (RANK[input.severity] > highest) {
    return { send: true, reason: 'escalated' };
  }

  return { send: false, reason: `already told the family at ${input.severity} severity today` };
}
