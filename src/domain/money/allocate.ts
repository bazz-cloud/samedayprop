/**
 * Deterministic allocation of a total amount across weighted line items.
 *
 * Used for two things that must agree exactly, forever:
 *   1. Splitting a coupon discount across order lines at purchase time.
 *   2. Reversing that same discount when a line is refunded.
 *
 * Because the allocation is a pure function of (total, weights, order), the
 * refund path recomputes the identical per-line figures years later from the
 * stored snapshot — no drift, no orphaned cent. The largest-remainder method
 * guarantees the parts sum to the total EXACTLY, which naive per-line rounding
 * does not.
 */

import { Money, type Currency, USD } from './money';

export interface Allocation {
  /** Index into the input weights array. */
  index: number;
  amount: Money;
}

/**
 * Split `total` across `weights` proportionally, with the remainder cents given
 * to the lines with the largest fractional parts. Ties break toward the LOWEST
 * index so the result is stable regardless of sort order upstream.
 *
 * Invariant: `sum(result) === total`.
 */
export function allocateByWeight(
  total: Money,
  weights: readonly bigint[],
  currency: Currency = USD,
): Allocation[] {
  if (weights.length === 0) {
    if (!total.isZero()) {
      throw new Error('Cannot allocate a non-zero total across zero lines');
    }
    return [];
  }
  if (weights.some((w) => w < 0n)) {
    throw new Error('Allocation weights must be non-negative');
  }

  const weightTotal = weights.reduce((a, b) => a + b, 0n);
  if (weightTotal === 0n) {
    if (!total.isZero()) {
      throw new Error('Cannot allocate a non-zero total across zero-weight lines');
    }
    return weights.map((_, index) => ({ index, amount: Money.zero(currency) }));
  }

  const sign = total.minor < 0n ? -1n : 1n;
  const absTotal = total.minor < 0n ? -total.minor : total.minor;

  // Floor share plus the remainder for each line.
  const base: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let distributed = 0n;

  for (let index = 0; index < weights.length; index += 1) {
    const numerator = absTotal * weights[index]!;
    const share = numerator / weightTotal;
    base.push(share);
    distributed += share;
    remainders.push({ index, remainder: numerator - share * weightTotal });
  }

  // Hand out the leftover minor units, largest remainder first, lowest index on ties.
  let leftover = absTotal - distributed;
  remainders.sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.index - b.index;
  });
  for (const entry of remainders) {
    if (leftover <= 0n) break;
    base[entry.index] = (base[entry.index] ?? 0n) + 1n;
    leftover -= 1n;
  }

  return base.map((minor, index) => ({
    index,
    amount: Money.fromMinor(minor * sign, currency),
  }));
}

/** Convenience wrapper: allocate proportionally to a set of Money amounts. */
export function allocateProportionally(total: Money, lineAmounts: readonly Money[]): Allocation[] {
  return allocateByWeight(
    total,
    lineAmounts.map((m) => m.minor),
    total.currency,
  );
}
