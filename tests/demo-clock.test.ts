import { describe, expect, it } from 'vitest';
import { clockFor, headerValue, parseDemoMinute } from '../src/mcp/demo-clock.js';
import { fromLocal, localParts } from '../src/domain/time.js';

const TZ = 'Europe/London';
const realNow = () => Date.UTC(2026, 9, 13, 14, 19); // 15:19 in London, BST

describe('demo clock', () => {
  it('moves the time of day, never the date', () => {
    const now = clockFor(570, true, realNow)(TZ);
    const parts = localParts(now, TZ);
    expect(parts.dateKey).toBe('2026-10-13');
    expect(parts.minutesOfDay).toBe(570);
    expect(now).toBe(fromLocal('2026-10-13', 570, TZ));
  });

  it('is ignored unless the deployment enables it', () => {
    // A production household cannot be time-travelled by a client sending a header.
    expect(clockFor(570, false, realNow)(TZ)).toBe(realNow());
  });

  it('falls back to real time when no minute is given', () => {
    expect(clockFor(undefined, true, realNow)(TZ)).toBe(realNow());
  });

  it('accepts only whole minutes within a day', () => {
    expect(parseDemoMinute('570')).toBe(570);
    expect(parseDemoMinute('0')).toBe(0);
    expect(parseDemoMinute('1439')).toBe(1439);
    for (const bad of ['1440', '-1', '9.5', 'nine', '', undefined]) {
      expect(parseDemoMinute(bad), String(bad)).toBeUndefined();
    }
  });

  it('reads the header case-insensitively', () => {
    expect(headerValue({ 'X-Still-There-Demo-Minute': '600' }, 'x-still-there-demo-minute')).toBe('600');
  });
});
