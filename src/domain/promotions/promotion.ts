/**
 * Promotions, priced against exposure rather than against margin.
 *
 * A discount here is not a margin cut. The account fee is the only revenue
 * standing against a contingent liability of 13x-23x, and THE CAP DOES NOT MOVE
 * WHEN THE PRICE DOES. Halving the price of a $25,000 account does not halve
 * what the firm might owe on it; it doubles the ratio between the two.
 *
 *   $25K account   price      cap        ratio
 *   list           $349.00    $6,000     17.2x
 *   25% off        $261.75    $6,000     22.9x
 *   40% off        $209.40    $6,000     28.7x
 *   50% off        $174.50    $6,000     34.4x
 *
 * So every function here that changes a price also reports what it does to that
 * ratio, and `evaluatePromotion` refuses to return an approvable result when a
 * tier crosses the configured ceiling without an explicit override.
 *
 * Two kinds are deliberately treated as dangerous rather than merely expensive:
 *
 *   TIER UPGRADE   selling a $50,000 account at the $25,000 price raises the
 *                  absolute ceiling, not just the ratio. $261.75 against a
 *                  $9,000 cap is 34x, and the firm's worst case per customer
 *                  goes UP rather than the revenue going down.
 *   BUNDLE         several accounts to one buyer manufactures exactly the
 *                  correlated exposure the detector exists to find: one trader,
 *                  one idea, fanned across accounts that each carry a full cap.
 *
 * Resets are the opposite and are the safest thing to discount: a reset buyer
 * has already consumed part of their lifetime capacity and a reset does not
 * restore it, so the same fee buys strictly less remaining exposure.
 */

import { Money } from '@/domain/money/money';
import type { PlanKey } from '@/domain/catalog/plans';

export type PromotionKind =
  /** Percent off an account fee. */
  | 'PERCENT_OFF_ACCOUNT'
  /** Fixed amount off an account fee. */
  | 'FIXED_OFF_ACCOUNT'
  /** Percent off a reset. Preferred: a reset buys less remaining exposure. */
  | 'PERCENT_OFF_RESET'
  /** A reset thrown in at zero. A $0 line item, never a discount on the fee. */
  | 'FREE_RESET'
  /** Attribution to a referrer. May carry a discount as well. */
  | 'REFERRAL'
  /** Sells a tier at a cheaper tier's price. Raises the absolute ceiling. */
  | 'TIER_UPGRADE'
  /** Several accounts to one buyer. Manufactures correlated exposure. */
  | 'BUNDLE';

/** Kinds that need an explicit, reasoned override before they can be saved. */
export const GATED_KINDS: readonly PromotionKind[] = ['TIER_UPGRADE', 'BUNDLE'];

export interface PromotionDraft {
  readonly code: string;
  readonly kind: PromotionKind;
  /** Basis points off, so 2500 is 25%. Integer: no float percentages. */
  readonly percentOffBps: number;
  readonly fixedOffMinor: bigint;
  /** Empty means every tier. Most promotions should NOT apply to every tier. */
  readonly appliesToTiers: readonly PlanKey[];
  /** Absolute UTC instants. A local string expires a sale hours early. */
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly maxRedemptions: number | null;
  readonly maxRedemptionsPerCustomer: number | null;
}

export interface TierEconomics {
  readonly planKey: PlanKey;
  readonly label: string;
  readonly listPriceMinor: bigint;
  readonly lifetimeCapMinor: bigint | null;
}

export interface TierImpact {
  readonly planKey: PlanKey;
  readonly label: string;
  readonly listPriceMinor: bigint;
  readonly discountedPriceMinor: bigint;
  readonly discountMinor: bigint;
  readonly lifetimeCapMinor: bigint | null;
  /** Cap ÷ price at list. Null when the cap is unresolved or the price is zero. */
  readonly listRatio: number | null;
  /** Cap ÷ price after the discount. This is the number that matters. */
  readonly discountedRatio: number | null;
  readonly exceedsCeiling: boolean;
}

export interface PromotionEvaluation {
  readonly impacts: readonly TierImpact[];
  /** The worst ratio this promotion produces across the tiers it touches. */
  readonly worstRatio: number | null;
  readonly ceiling: number;
  /** True when nothing crosses the ceiling and the kind is not gated. */
  readonly approvable: boolean;
  /** Why it is not approvable. Empty when it is. */
  readonly blockers: readonly string[];
  /** True when an override with a typed reason would be required to save it. */
  readonly requiresOverride: boolean;
}

/** Default ceiling. Configurable; the $25K tier already sits at 22.9x on START25. */
export const DEFAULT_RATIO_CEILING = 25;

/** Exact percentage arithmetic on integers. No float ever touches a price. */
export function applyPercentOffBps(priceMinor: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error(`Percent off must be 0-10000 basis points; received ${bps}`);
  }
  const off = Money.fromMinor(priceMinor).mulRatio(BigInt(bps), 10_000n, 'half-up');
  return priceMinor - off.minor;
}

function ratioOf(capMinor: bigint | null, priceMinor: bigint): number | null {
  if (capMinor === null) return null;
  if (priceMinor <= 0n) return null;
  return Number(capMinor) / Number(priceMinor);
}

/** The price a tier would sell at under this promotion. */
export function discountedPrice(draft: PromotionDraft, listPriceMinor: bigint): bigint {
  switch (draft.kind) {
    case 'PERCENT_OFF_ACCOUNT':
    case 'REFERRAL':
      return applyPercentOffBps(listPriceMinor, draft.percentOffBps);
    case 'FIXED_OFF_ACCOUNT': {
      const price = listPriceMinor - draft.fixedOffMinor;
      return price > 0n ? price : 0n;
    }
    case 'TIER_UPGRADE':
      // The buyer pays the cheaper tier's price, supplied as the fixed amount.
      return draft.fixedOffMinor;
    case 'PERCENT_OFF_RESET':
    case 'FREE_RESET':
    case 'BUNDLE':
      // These do not change an account fee, so the account's own ratio is
      // unchanged. Bundles are dangerous for a different reason, handled below.
      return listPriceMinor;
  }
}

/**
 * What a promotion does to the exposure ratio of every tier it touches.
 *
 * Called live as the discount is edited, before anything can be saved, because
 * the ratio is the decision — not the percentage.
 */
export function evaluatePromotion(
  draft: PromotionDraft,
  tiers: readonly TierEconomics[],
  options: { ceiling?: number; overrideReason?: string } = {},
): PromotionEvaluation {
  const ceiling = options.ceiling ?? DEFAULT_RATIO_CEILING;
  const scope =
    draft.appliesToTiers.length === 0
      ? tiers
      : tiers.filter((tier) => draft.appliesToTiers.includes(tier.planKey));

  const impacts: TierImpact[] = scope.map((tier) => {
    const discountedPriceMinor = discountedPrice(draft, tier.listPriceMinor);
    const discountedRatio = ratioOf(tier.lifetimeCapMinor, discountedPriceMinor);
    return {
      planKey: tier.planKey,
      label: tier.label,
      listPriceMinor: tier.listPriceMinor,
      discountedPriceMinor,
      discountMinor: tier.listPriceMinor - discountedPriceMinor,
      lifetimeCapMinor: tier.lifetimeCapMinor,
      listRatio: ratioOf(tier.lifetimeCapMinor, tier.listPriceMinor),
      discountedRatio,
      exceedsCeiling: discountedRatio !== null && discountedRatio > ceiling,
    };
  });

  const ratios = impacts
    .map((impact) => impact.discountedRatio)
    .filter((ratio): ratio is number => ratio !== null);
  const worstRatio = ratios.length === 0 ? null : Math.max(...ratios);

  const blockers: string[] = [];

  if (scope.length === 0) {
    blockers.push('This promotion applies to no tier, so it would never discount anything.');
  }

  for (const impact of impacts) {
    if (impact.exceedsCeiling) {
      blockers.push(
        `${impact.label} reaches ${impact.discountedRatio!.toFixed(1)}x, above the ${ceiling}x ceiling.`,
      );
    }
    if (impact.lifetimeCapMinor === null) {
      blockers.push(
        `${impact.label} has no approved lifetime cap, so its exposure ratio cannot be computed.`,
      );
    }
    if (impact.discountedPriceMinor <= 0n && draft.kind !== 'FREE_RESET') {
      blockers.push(`${impact.label} would sell for nothing, which has no exposure ratio at all.`);
    }
  }

  if (draft.kind === 'TIER_UPGRADE') {
    blockers.push(
      'A tier upgrade raises the absolute worst case, not just the ratio: the buyer gets a larger ' +
        'cap for a smaller fee.',
    );
  }
  if (draft.kind === 'BUNDLE') {
    blockers.push(
      'A bundle puts several full caps behind one trader, which is the correlated exposure the ' +
        'cluster detector exists to find.',
    );
  }

  if (draft.endsAt && draft.startsAt && draft.endsAt <= draft.startsAt) {
    blockers.push('The end time is not after the start time.');
  }

  const requiresOverride = blockers.length > 0;
  const overridden = Boolean(options.overrideReason && options.overrideReason.trim().length >= 10);

  return {
    impacts,
    worstRatio,
    ceiling,
    approvable: blockers.length === 0 || overridden,
    blockers,
    requiresOverride,
  };
}

// ---------------------------------------------------------------------------
// Pricing at checkout
// ---------------------------------------------------------------------------

export interface ActivePromotion {
  readonly id: string;
  readonly code: string;
  readonly kind: PromotionKind;
  readonly percentOffBps: number;
  readonly fixedOffMinor: bigint;
  readonly appliesToTiers: readonly PlanKey[];
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
}

export interface PromotionChoice {
  readonly promotion: ActivePromotion | null;
  readonly discountedPriceMinor: bigint;
  readonly discountMinor: bigint;
  /** Promotions considered but not chosen, with why. */
  readonly rejected: readonly { code: string; reason: string }[];
}

/**
 * The best single promotion for a purchase.
 *
 * DISCOUNTS NEVER STACK. The best one wins, computed here on the server from
 * the live promotion set — a client supplies a code, never a price.
 *
 * Ties break on the code, alphabetically, so the same basket always produces
 * the same answer. A non-deterministic winner would make a refund reproduce a
 * different price from the purchase.
 */
export function chooseBestPromotion(input: {
  planKey: PlanKey;
  listPriceMinor: bigint;
  candidates: readonly ActivePromotion[];
  now: Date;
}): PromotionChoice {
  const rejected: { code: string; reason: string }[] = [];
  const eligible: { promotion: ActivePromotion; priceMinor: bigint }[] = [];

  for (const promotion of input.candidates) {
    if (promotion.startsAt && input.now < promotion.startsAt) {
      rejected.push({ code: promotion.code, reason: 'Not started yet.' });
      continue;
    }
    if (promotion.endsAt && input.now >= promotion.endsAt) {
      rejected.push({ code: promotion.code, reason: 'Ended.' });
      continue;
    }
    if (
      promotion.appliesToTiers.length > 0 &&
      !promotion.appliesToTiers.includes(input.planKey)
    ) {
      rejected.push({ code: promotion.code, reason: 'Does not apply to this account size.' });
      continue;
    }
    if (promotion.kind === 'PERCENT_OFF_RESET' || promotion.kind === 'FREE_RESET') {
      rejected.push({ code: promotion.code, reason: 'Applies to resets, not to an account fee.' });
      continue;
    }

    const draft: PromotionDraft = {
      code: promotion.code,
      kind: promotion.kind,
      percentOffBps: promotion.percentOffBps,
      fixedOffMinor: promotion.fixedOffMinor,
      appliesToTiers: promotion.appliesToTiers,
      startsAt: promotion.startsAt,
      endsAt: promotion.endsAt,
      maxRedemptions: null,
      maxRedemptionsPerCustomer: null,
    };
    eligible.push({ promotion, priceMinor: discountedPrice(draft, input.listPriceMinor) });
  }

  if (eligible.length === 0) {
    return {
      promotion: null,
      discountedPriceMinor: input.listPriceMinor,
      discountMinor: 0n,
      rejected,
    };
  }

  eligible.sort((a, b) => {
    if (a.priceMinor !== b.priceMinor) return a.priceMinor < b.priceMinor ? -1 : 1;
    return a.promotion.code.localeCompare(b.promotion.code);
  });

  const [best, ...alsoRan] = eligible;
  for (const other of alsoRan) {
    rejected.push({ code: other.promotion.code, reason: 'A better discount applied instead.' });
  }

  return {
    promotion: best!.promotion,
    discountedPriceMinor: best!.priceMinor,
    discountMinor: input.listPriceMinor - best!.priceMinor,
    rejected,
  };
}

// ---------------------------------------------------------------------------
// Marketing copy
// ---------------------------------------------------------------------------

export type ClaimSeverity = 'EARNINGS_CLAIM' | 'GUARANTEE' | 'IMPLIES_REAL_FUNDS';

export interface ClaimFinding {
  readonly severity: ClaimSeverity;
  readonly match: string;
  readonly note: string;
}

const CLAIM_PATTERNS: readonly { kind: ClaimSeverity; pattern: RegExp; note: string }[] = [
  {
    kind: 'EARNINGS_CLAIM',
    pattern: /\b(earn|make|profit|income|payout)s?\s+(up\s+to\s+)?\$?\d/i,
    note: 'Reads as an earnings claim. Income claims are a known enforcement area.',
  },
  {
    kind: 'EARNINGS_CLAIM',
    pattern: /\b(six|seven)[-\s]figure|\bget rich|\breplace your (income|salary|job)\b/i,
    note: 'Implies a level of income from participating.',
  },
  {
    kind: 'GUARANTEE',
    pattern: /\bguarantee(d|s)?\b|\brisk[-\s]free\b|\bno risk\b|\bassured\b/i,
    note: 'Nothing here is guaranteed. Most participants receive no payout.',
  },
  {
    kind: 'IMPLIES_REAL_FUNDS',
    pattern: /\breal (money|capital|funds)\b|\bour capital\b|\blive account\b|\bfunded trader\b/i,
    note: 'Implies real brokerage funds. Accounts are simulated and balances are nominal.',
  },
  {
    kind: 'IMPLIES_REAL_FUNDS',
    pattern: /\btrade (our|real|company) (money|capital)\b|\bwe fund you\b/i,
    note: 'Implies the firm places real capital at the trader’s disposal.',
  },
];

/**
 * Advisory linter for customer-facing promotional copy.
 *
 * Advisory, never blocking: a linter that refuses to publish would be routed
 * around within a week. Findings are attached to the audit entry so the
 * decision to publish anyway is recorded rather than invisible.
 */
export function lintPromotionalCopy(text: string): readonly ClaimFinding[] {
  const findings: ClaimFinding[] = [];
  for (const { kind, pattern, note } of CLAIM_PATTERNS) {
    const match = pattern.exec(text);
    if (match) findings.push({ severity: kind, match: match[0], note });
  }
  return findings;
}
