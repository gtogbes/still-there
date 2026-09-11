import { describe, expect, it } from 'vitest';
import { addDays, formatMinute, fromLocal, isQuietMinute, localParts } from '../src/domain/time.js';

describe('local time handling', () => {
  it('round-trips a local wall-clock time', () => {
    const at = fromLocal('2026-09-10', 7 * 60 + 40, 'Europe/London');
    const parts = localParts(at, 'Europe/London');
    expect(parts.dateKey).toBe('2026-09-10');
    expect(parts.minutesOfDay).toBe(7 * 60 + 40);
  });

  it('keeps a routine at the same wall-clock time across the autumn DST change', () => {
    // UK clocks go back on 2026-10-25. Ese still gets up at 07:40; if the
    // baseline were stored as a UTC offset it would drift by an hour overnight
    // and the system would spend a week reporting a problem that is not there.
    const before = localParts(fromLocal('2026-10-24', 460, 'Europe/London'), 'Europe/London');
    const after = localParts(fromLocal('2026-10-26', 460, 'Europe/London'), 'Europe/London');
    expect(before.minutesOfDay).toBe(460);
    expect(after.minutesOfDay).toBe(460);
  });

  it('produces a real instant on the spring-forward day', () => {
    // 2026-03-29 01:00 local does not exist in Europe/London. The helper must
    // still return a usable instant rather than looping or returning NaN.
    const at = fromLocal('2026-03-29', 60, 'Europe/London');
    expect(Number.isFinite(at)).toBe(true);
    expect(localParts(at, 'Europe/London').dateKey).toBe('2026-03-29');
  });

  it('rolls minute overflow into the following day', () => {
    const at = fromLocal('2026-09-10', 25 * 60, 'Europe/London');
    expect(localParts(at, 'Europe/London').dateKey).toBe('2026-09-11');
  });

  it('advances date keys across month boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('treats a window that wraps midnight as quiet', () => {
    const quietFrom = 23 * 60;
    const quietTo = 6 * 60;
    expect(isQuietMinute(3 * 60, quietFrom, quietTo)).toBe(true);
    expect(isQuietMinute(23 * 60 + 30, quietFrom, quietTo)).toBe(true);
    expect(isQuietMinute(12 * 60, quietFrom, quietTo)).toBe(false);
    expect(isQuietMinute(6 * 60, quietFrom, quietTo)).toBe(false);
  });

  it('formats minutes as local clock time', () => {
    expect(formatMinute(0)).toBe('00:00');
    expect(formatMinute(7 * 60 + 5)).toBe('07:05');
    expect(formatMinute(23 * 60 + 59)).toBe('23:59');
  });
});
