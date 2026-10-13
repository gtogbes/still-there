import { fromLocal, localParts } from '../domain/time.js';

/**
 * The demo clock.
 *
 * A demonstration has three minutes to show a morning unfold, and a morning takes
 * five hours. So a caller may say "answer as though it is 09:30 today", via the
 * `x-still-there-demo-minute` header, and every tool reasons about that moment.
 *
 * Two things keep this honest:
 *
 *   - It is off unless the deployment sets DEMO_CLOCK=enabled. A production
 *     household cannot be time-travelled by a client.
 *   - It only moves the time of day, never the date, and only within today. The
 *     events are real stored rows with real timestamps; the clock changes which
 *     moment we ask about, not what happened.
 *
 * It works without touching any reasoning code because nothing in src/domain reads
 * the clock — the constraint set in the first commit.
 */

export const DEMO_MINUTE_HEADER = 'x-still-there-demo-minute';

export function parseDemoMinute(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 1439) return undefined;
  return value;
}

export function clockFor(
  demoMinute: number | undefined,
  enabled: boolean,
  realNow: () => number = Date.now,
): (timeZone: string) => number {
  if (!enabled || demoMinute === undefined) return () => realNow();
  return (timeZone) => {
    const today = localParts(realNow(), timeZone).dateKey;
    return fromLocal(today, demoMinute, timeZone);
  };
}

export function headerValue(
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (headers === undefined) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}
