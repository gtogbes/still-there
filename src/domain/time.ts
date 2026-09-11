import type { DayClass } from './types.js';

/**
 * Local-time helpers built on Intl, so DST is handled by the platform database
 * rather than by us guessing offsets.
 *
 * Routines are anchored in *local* wall-clock time: someone who gets up at 7:40
 * still gets up at 7:40 the morning the clocks change. Storing anchors as local
 * minute-of-day means the baseline survives a DST transition untouched, which
 * would not be true of UTC offsets.
 */

export interface LocalParts {
  /** 'YYYY-MM-DD' in the household's zone. */
  readonly dateKey: string;
  /** Minutes since local midnight, 0..1439. */
  readonly minutesOfDay: number;
  /** 0 = Sunday .. 6 = Saturday. */
  readonly weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let existing = formatters.get(timeZone);
  if (existing === undefined) {
    existing = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, existing);
  }
  return existing;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export function localParts(at: number, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(at));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (found === undefined) throw new Error(`missing ${type} in formatted date`);
    return Number(found.value);
  };
  const year = read('year');
  const month = read('month');
  const day = read('day');
  const hour = read('hour');
  const minute = read('minute');
  return {
    dateKey: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`,
    minutesOfDay: hour * 60 + minute,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

function dateKeyToUtcMidnight(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`invalid dateKey: ${dateKey}`);
  }
  return Date.UTC(y, m - 1, d);
}

/**
 * Inverse of localParts: the instant at which the given local wall-clock time
 * occurs in the given zone.
 *
 * Converges by measuring the error and correcting, because the offset we need
 * depends on the instant we are trying to find. Two passes settle every real
 * zone; the third is insurance for transitions that land mid-correction.
 *
 * Minute values outside 0..1439 are allowed and roll into adjacent days, which
 * keeps caller arithmetic simple.
 */
export function fromLocal(dateKey: string, minutesOfDay: number, timeZone: string): number {
  const target = dateKeyToUtcMidnight(dateKey) + minutesOfDay * 60_000;
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = localParts(guess, timeZone);
    const actual = dateKeyToUtcMidnight(parts.dateKey) + parts.minutesOfDay * 60_000;
    const drift = target - actual;
    if (drift === 0) return guess;
    guess += drift;
  }
  return guess;
}

export function addDays(dateKey: string, days: number): string {
  const shifted = new Date(dateKeyToUtcMidnight(dateKey) + days * 86_400_000);
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1, 2)}-${pad(
    shifted.getUTCDate(),
    2,
  )}`;
}

export function weekdayOf(dateKey: string): number {
  return new Date(dateKeyToUtcMidnight(dateKey)).getUTCDay();
}

export function dayClassOf(weekday: number): DayClass {
  return weekday === 0 || weekday === 6 ? 'weekend' : 'weekday';
}

/** Formats a local minute-of-day as 'HH:MM'. */
export function formatMinute(minutesOfDay: number): string {
  const normalised = ((minutesOfDay % 1440) + 1440) % 1440;
  return `${pad(Math.floor(normalised / 60), 2)}:${pad(normalised % 60, 2)}`;
}

/**
 * Whether a local minute falls in the household's night window.
 *
 * Handles the usual case where the window wraps midnight (23:00 to 06:00).
 * Silence at 3am is not a finding; that is just someone asleep.
 */
export function isQuietMinute(
  minutesOfDay: number,
  quietFromMinute: number,
  quietToMinute: number,
): boolean {
  if (quietFromMinute === quietToMinute) return false;
  if (quietFromMinute < quietToMinute) {
    return minutesOfDay >= quietFromMinute && minutesOfDay < quietToMinute;
  }
  return minutesOfDay >= quietFromMinute || minutesOfDay < quietToMinute;
}
