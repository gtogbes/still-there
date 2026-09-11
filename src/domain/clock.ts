/**
 * The only place allowed to know the real time.
 *
 * Domain code never calls Date.now(). It receives an instant. That single
 * constraint is what makes the whole system testable: a fixed clock replays
 * months of history deterministically, and a scaled clock turns a 24-hour
 * routine into a 20-minute demo without touching the reasoning logic.
 */
export interface Clock {
  now(): number;
}

export function systemClock(): Clock {
  return { now: () => Date.now() };
}

/** A clock frozen at a chosen instant. The workhorse of the test suite. */
export function fixedClock(at: number): Clock {
  return { now: () => at };
}

/**
 * A clock that advances faster than real time.
 *
 * Used for the demo: with `factor: 72` a twenty-minute recording covers a full
 * simulated day, so a routine can be established and then broken on camera.
 * Always state the compression factor on screen when demoing — labelling it
 * reads as engineering, hiding it reads as a faked result.
 */
export function scaledClock(startedAt: number, factor: number, source: Clock): Clock {
  const origin = source.now();
  return { now: () => startedAt + (source.now() - origin) * factor };
}

/** A clock the test drives by hand. */
export function manualClock(at: number): Clock & { set(next: number): void; advance(ms: number): void } {
  let current = at;
  return {
    now: () => current,
    set(next: number) {
      current = next;
    },
    advance(ms: number) {
      current += ms;
    },
  };
}
