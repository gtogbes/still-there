/**
 * Seeded PRNG (mulberry32).
 *
 * Deterministic on purpose. A test suite whose synthetic households differ
 * between runs produces false-positive rates that drift, which is worse than no
 * measurement at all — you can never tell whether a change improved the system
 * or the dice.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in [min, max]. */
export function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Symmetric jitter in [-spread, +spread]. */
export function jitter(rng: () => number, spread: number): number {
  return Math.round((rng() * 2 - 1) * spread);
}
