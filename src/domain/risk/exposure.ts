/**
 * Position and pending-order exposure limits.
 *
 * Contracts are converted to MICRO-EQUIVALENT units so mini and micro contracts
 * share one ceiling: the confirmed "4 minis or 40 micros" is a single limit of
 * 40 micro-equivalents, not two independent limits that could be filled twice.
 *
 * Three rules this module exists to enforce:
 *
 *  1. Pending exposure counts. Two working entry orders that would each fit
 *     under the cap must not be allowed to fill simultaneously and exceed it.
 *  2. Netting happens only WITHIN a configured netting group. A long in one
 *     product does not offset a short in an unrelated one — different
 *     instruments carry different dollar risk per contract and netting them
 *     would let a trader bypass the cap entirely.
 *  3. A product with no approved risk configuration is rejected outright rather
 *     than assumed to carry the same risk as everything else.
 *
 * OCO/bracket handling: legs of a one-cancels-other group are mutually
 * exclusive, so only the largest leg in each group counts. Reduce-intent orders
 * (take-profit, stop-loss, flatten) never reduce projected exposure, because an
 * order that has not filled may never fill.
 */

export type OrderIntent = 'INCREASE' | 'REDUCE';

export interface ProductSpec {
  readonly symbol: string;
  /** Products net against each other only inside the same group. */
  readonly nettingGroup: string;
  /** Micro-equivalent units per contract: 10 for a mini, 1 for a micro. */
  readonly microEquivalentsPerContract: number;
  /** False until product-specific risk controls have been approved. */
  readonly approved: boolean;
  readonly description: string;
}

export interface PositionLike {
  readonly symbol: string;
  /** Positive is long, negative is short. */
  readonly signedQuantity: number;
}

export interface WorkingOrderLike {
  readonly symbol: string;
  /** Positive is buy, negative is sell. */
  readonly signedQuantity: number;
  readonly intent: OrderIntent;
  /** Orders sharing a group are mutually exclusive; null means standalone. */
  readonly ocoGroupId: string | null;
}

export interface ExposureByGroup {
  readonly nettingGroup: string;
  /** Current net filled exposure, signed, in micro-equivalents. */
  readonly netFilled: number;
  /** Worst-case absolute exposure once working entry orders are considered. */
  readonly worstCase: number;
}

export interface ExposureResult {
  readonly byGroup: readonly ExposureByGroup[];
  /**
   * Total worst-case exposure in micro-equivalents: the sum of the ABSOLUTE
   * worst case of each group, so unrelated products can never offset.
   */
  readonly totalWorstCase: number;
  /** Current total filled exposure, absolute, summed across groups. */
  readonly totalFilled: number;
  readonly unapprovedSymbols: readonly string[];
}

export class UnknownProductError extends Error {}

function specFor(symbol: string, products: ReadonlyMap<string, ProductSpec>): ProductSpec {
  const spec = products.get(symbol);
  if (!spec) {
    throw new UnknownProductError(
      `No risk configuration for ${symbol}. Trading an unconfigured instrument is refused ` +
        'rather than assumed equivalent to a configured one.',
    );
  }
  return spec;
}

export function computeExposure(
  positions: readonly PositionLike[],
  workingOrders: readonly WorkingOrderLike[],
  products: ReadonlyMap<string, ProductSpec>,
): ExposureResult {
  const unapproved = new Set<string>();
  const groups = new Map<
    string,
    { netFilled: number; pendingBuy: number; pendingSell: number; oco: Map<string, number[]> }
  >();

  const group = (name: string) => {
    let entry = groups.get(name);
    if (!entry) {
      entry = { netFilled: 0, pendingBuy: 0, pendingSell: 0, oco: new Map() };
      groups.set(name, entry);
    }
    return entry;
  };

  for (const position of positions) {
    const spec = specFor(position.symbol, products);
    if (!spec.approved) unapproved.add(spec.symbol);
    group(spec.nettingGroup).netFilled +=
      position.signedQuantity * spec.microEquivalentsPerContract;
  }

  // Standalone entry orders accumulate directly. OCO legs are collected per
  // group so only the largest leg of each set counts.
  for (const order of workingOrders) {
    const spec = specFor(order.symbol, products);
    if (!spec.approved) unapproved.add(spec.symbol);
    if (order.intent === 'REDUCE') continue;

    const units = order.signedQuantity * spec.microEquivalentsPerContract;
    const entry = group(spec.nettingGroup);

    if (order.ocoGroupId) {
      const legs = entry.oco.get(order.ocoGroupId) ?? [];
      legs.push(units);
      entry.oco.set(order.ocoGroupId, legs);
      continue;
    }

    if (units > 0) entry.pendingBuy += units;
    else entry.pendingSell += -units;
  }

  const byGroup: ExposureByGroup[] = [];
  let totalWorstCase = 0;
  let totalFilled = 0;

  for (const [name, entry] of groups) {
    let pendingBuy = entry.pendingBuy;
    let pendingSell = entry.pendingSell;

    // Only one leg of an OCO set can fill. Charge the set its largest leg on
    // whichever side that leg sits.
    for (const legs of entry.oco.values()) {
      let worstLeg = 0;
      for (const leg of legs) {
        if (Math.abs(leg) > Math.abs(worstLeg)) worstLeg = leg;
      }
      if (worstLeg > 0) pendingBuy += worstLeg;
      else pendingSell += -worstLeg;
    }

    const maxLong = entry.netFilled + pendingBuy;
    const maxShort = entry.netFilled - pendingSell;
    const worstCase = Math.max(Math.abs(entry.netFilled), Math.abs(maxLong), Math.abs(maxShort));

    byGroup.push({ nettingGroup: name, netFilled: entry.netFilled, worstCase });
    totalWorstCase += worstCase;
    totalFilled += Math.abs(entry.netFilled);
  }

  byGroup.sort((a, b) => a.nettingGroup.localeCompare(b.nettingGroup));

  return {
    byGroup,
    totalWorstCase,
    totalFilled,
    unapprovedSymbols: [...unapproved].sort(),
  };
}

export interface ExposureDecision {
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly projectedMicroEquivalents: number;
  readonly capMicroEquivalents: number;
}

/**
 * Decide whether an additional entry order may be accepted.
 *
 * Evaluated against the WORST CASE including everything already working, so
 * concurrent order submissions cannot race past the ceiling.
 */
export function evaluateNewOrder(
  positions: readonly PositionLike[],
  workingOrders: readonly WorkingOrderLike[],
  candidate: WorkingOrderLike,
  products: ReadonlyMap<string, ProductSpec>,
  capMicroEquivalents: number,
): ExposureDecision {
  let projected: ExposureResult;
  try {
    projected = computeExposure(positions, [...workingOrders, candidate], products);
  } catch (error) {
    if (error instanceof UnknownProductError) {
      return {
        allowed: false,
        reason: error.message,
        projectedMicroEquivalents: 0,
        capMicroEquivalents,
      };
    }
    throw error;
  }

  if (projected.unapprovedSymbols.length > 0) {
    return {
      allowed: false,
      reason:
        `Instruments awaiting approved risk controls: ${projected.unapprovedSymbols.join(', ')}.`,
      projectedMicroEquivalents: projected.totalWorstCase,
      capMicroEquivalents,
    };
  }

  if (projected.totalWorstCase > capMicroEquivalents) {
    return {
      allowed: false,
      reason:
        `Order would allow ${projected.totalWorstCase} micro-equivalent units against a ceiling ` +
        `of ${capMicroEquivalents}, counting filled positions and every working entry order.`,
      projectedMicroEquivalents: projected.totalWorstCase,
      capMicroEquivalents,
    };
  }

  return {
    allowed: true,
    reason: null,
    projectedMicroEquivalents: projected.totalWorstCase,
    capMicroEquivalents,
  };
}

/** Convert a plan's "N minis or M micros" ceiling into micro-equivalent units. */
export function ceilingToMicroEquivalents(ceiling: { minis: number; micros: number }): number {
  // The confirmed table is internally consistent at 10 micros per mini.
  const fromMinis = ceiling.minis * 10;
  if (fromMinis !== ceiling.micros) {
    throw new Error(
      `Position ceiling is inconsistent: ${ceiling.minis} minis implies ${fromMinis} ` +
        `micro-equivalents but the micro ceiling is ${ceiling.micros}. ` +
        'Resolve the product mapping before enforcing a single combined cap.',
    );
  }
  return ceiling.micros;
}
