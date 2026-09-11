/**
 * Median and MAD rather than mean and standard deviation.
 *
 * A single unusual day — a hospital visit, a grandchild staying over — drags a
 * mean badly and inflates a standard deviation, which then widens every
 * threshold derived from it and quietly makes the system blind. The median and
 * median absolute deviation shrug that off.
 */

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median of an empty set');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) {
    const value = sorted[mid];
    if (value === undefined) throw new Error('unreachable: median index out of range');
    return value;
  }
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (lower === undefined || upper === undefined) {
    throw new Error('unreachable: median index out of range');
  }
  return (lower + upper) / 2;
}

/** Median absolute deviation from the median. */
export function medianAbsoluteDeviation(values: readonly number[]): number {
  if (values.length === 0) throw new Error('MAD of an empty set');
  const centre = median(values);
  return median(values.map((v) => Math.abs(v - centre)));
}

/**
 * Linearly interpolated quantile.
 *
 * Needed because deadlines are a question about the upper tail, not about
 * spread. Median plus a multiple of the MAD assumes the distribution is roughly
 * symmetric, and a person's day is not: most mornings cluster tightly and then
 * there is a long straggling tail of late starts. Asking the data directly where
 * its 95th percentile sits gives a tight deadline for a regular household and a
 * wide one for an irregular household, with no tuning constant to argue about.
 */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) throw new Error('quantile of an empty set');
  if (q <= 0) {
    const first = [...values].sort((a, b) => a - b)[0];
    if (first === undefined) throw new Error('unreachable');
    return first;
  }
  const sorted = [...values].sort((a, b) => a - b);
  if (q >= 1) {
    const last = sorted[sorted.length - 1];
    if (last === undefined) throw new Error('unreachable');
    return last;
  }
  const position = (sorted.length - 1) * q;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) throw new Error('unreachable');
  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (position - lowerIndex);
}
