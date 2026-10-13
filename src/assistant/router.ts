/**
 * The fallback router: what someone said, mapped to a tool, without a model.
 *
 * Bedrock is the primary router — it understands phrasing this cannot. But the
 * assistant must still work when Bedrock is unavailable, throttled, misconfigured or
 * returns nonsense, for the same reason the notification falls back to deterministic
 * text: a welfare product that goes silent because a model is down is worse than one
 * that is merely less fluent.
 *
 * Deliberately conservative. When it cannot tell what was meant it asks, rather than
 * guessing — and the only tool it would ever guess is the read-only status check.
 */

export type ToolName =
  | 'still_there_status'
  | 'explain_last_alert'
  | 'describe_routine'
  | 'pause_monitoring'
  | 'resume_monitoring';

export type Route =
  | { readonly kind: 'tool'; readonly tool: ToolName; readonly args: Record<string, unknown> }
  | { readonly kind: 'reply'; readonly text: string };

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  a: 1,
  two: 2,
  couple: 2,
  three: 3,
  few: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
};

/**
 * An explicit length of time: "3 days", "a week", "a fortnight".
 *
 * Kept separate from the looser phrases ("next week", "today") because a bare
 * utterance is only treated as a pause duration when it is unmistakably one. An
 * earlier version accepted "today" here, which meant "How is Jasmine today?" paused
 * monitoring — the most dangerous misroute available.
 */
export function parseExplicitDays(utterance: string): number | undefined {
  const text = utterance.toLowerCase();

  if (/\bfortnight\b/.test(text)) return 14;

  const digit = /(\d{1,3})\s*(day|days|week|weeks)\b/.exec(text);
  if (digit?.[1] !== undefined) {
    const n = Number(digit[1]);
    return digit[2]?.startsWith('week') ? n * 7 : n;
  }

  const word = /\b(a|one|two|couple|three|few|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen)\s+(?:of\s+)?(day|days|week|weeks)\b/.exec(text);
  if (word?.[1] !== undefined) {
    const n = NUMBER_WORDS[word[1]] ?? 1;
    return word[2]?.startsWith('week') ? n * 7 : n;
  }

  return undefined;
}

/** Explicit durations plus looser phrases. Only used once a pause is already intended. */
export function parseDays(utterance: string): number | undefined {
  const explicit = parseExplicitDays(utterance);
  if (explicit !== undefined) return explicit;

  const text = utterance.toLowerCase();
  if (/\b(this|next|the)\s+week\b/.test(text)) return 7;
  if (/\b(this|next|the)\s+weekend\b/.test(text)) return 3;
  if (/\b(tonight|overnight|today)\b/.test(text)) return 1;
  return undefined;
}

export const HELP_TEXT =
  "I can tell you whether Jasmine's having a normal day, why I last messaged you, what her usual routine looks like, or pause watching while she's away.";

const ASK_DURATION = 'How many days should I pause for?';

export function routeByKeywords(utterance: string): Route {
  const text = utterance.toLowerCase().trim();
  if (text === '') return { kind: 'reply', text: HELP_TEXT };

  // Resume is checked before pause: "she's back from her trip" mentions a trip.
  if (/\b(she'?s|she is|mum'?s|mum is|is)\s+(back|home)\b|\bresume\b|\bstart watching\b|\bunpause\b|\bwatch(ing)? again\b/.test(text)) {
    return { kind: 'tool', tool: 'resume_monitoring', args: {} };
  }

  if (/\b(away|holiday|trip|travell?ing|visiting|pause|stop watching|stop monitoring|don'?t watch)\b/.test(text)) {
    const days = parseDays(text);
    if (days === undefined) return { kind: 'reply', text: ASK_DURATION };
    const reason = /\bholiday\b/.test(text)
      ? 'on holiday'
      : /\bvisiting\b/.test(text)
        ? 'visiting family'
        : 'away';
    return { kind: 'tool', tool: 'pause_monitoring', args: { days, reason } };
  }

  // A bare duration ("a week", "five days") is almost always the answer to the
  // question just asked — how long to pause for.
  const bareDays = parseExplicitDays(text);
  if (bareDays !== undefined && text.split(/\s+/).length <= 4) {
    return { kind: 'tool', tool: 'pause_monitoring', args: { days: bareDays, reason: 'away' } };
  }

  if (/\b(why|message|messaged|texted|text me|alert|notification|notified|buzz|what was that)\b/.test(text)) {
    return { kind: 'tool', tool: 'explain_last_alert', args: {} };
  }

  if (/\b(routine|normal day|usual|usually|habits?|pattern|what do you (watch|look) for|typical)\b/.test(text)) {
    return { kind: 'tool', tool: 'describe_routine', args: {} };
  }

  if (/\b(up|okay|ok|alright|all right|fine|well|how is|how's|news|check|moving|today|jasmine|mum|mom|she)\b/.test(text)) {
    return { kind: 'tool', tool: 'still_there_status', args: {} };
  }

  return { kind: 'reply', text: HELP_TEXT };
}
