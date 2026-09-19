/**
 * Coupon definition and validation.
 *
 * Coupons are always re-evaluated server-side against the trusted catalog. A
 * client may say which code it wants applied; it may never say what the code is
 * worth, what it applies to, or what the resulting price is.
 */

import { confirmed, type Governed } from '../config/requirement-status';

export type CouponScope = 'ACCOUNT_PLANS' | 'ADDONS' | 'ALL_ELIGIBLE';

export interface CouponDefinition {
  readonly code: string;
  /** Whole-percent discount. Stored as bigint so pricing stays in exact rationals. */
  readonly percentOff: bigint;
  readonly scope: CouponScope;
  /** Inclusive start of validity, ISO-8601. Null means "already valid". */
  readonly validFrom: string | null;
  /** Exclusive end of validity, ISO-8601. Null means "no expiry configured". */
  readonly validUntil: string | null;
  /** Global redemption ceiling. Null means unlimited. */
  readonly maxRedemptions: number | null;
  /** Per-customer redemption ceiling. Null means unlimited. */
  readonly maxRedemptionsPerCustomer: number | null;
  /** Coupons never stack: at most one may apply to an order. */
  readonly stackable: false;
  readonly active: boolean;
}

/**
 * The launch coupon.
 *
 * OWNER DECISION, 2026-09-19: START25, 25% off, unlimited uses, no per-customer
 * limit and no expiry. It is advertised on every page and typed in at checkout,
 * never applied automatically — the struck-through list price and the code in
 * the banner are the offer; entering the code is the customer accepting it.
 *
 * Unlimited and undated means this is effectively the price. Every model in
 * docs/FINANCIAL_STRESS.md is run on the discounted figure for that reason: a
 * coupon nobody can fail to use is not a discount, it is the price list.
 */
export const DEFAULT_COUPON: Governed<CouponDefinition> = confirmed(
  {
    code: 'START25',
    percentOff: 25n,
    scope: 'ALL_ELIGIBLE',
    validFrom: null,
    validUntil: null,
    maxRedemptions: null,
    maxRedemptionsPerCustomer: null,
    stackable: false,
    active: true,
  },
  'START25, 25% off every eligible item. Unlimited uses, no per-customer limit, no expiry.',
  'Owner decision 2026-09-19',
);

export type CouponRejectionReason =
  | 'UNKNOWN_CODE'
  | 'INACTIVE'
  | 'NOT_YET_VALID'
  | 'EXPIRED'
  | 'GLOBAL_LIMIT_REACHED'
  | 'CUSTOMER_LIMIT_REACHED'
  | 'NO_ELIGIBLE_ITEMS'
  | 'ALREADY_APPLIED';

export interface CouponUsageSnapshot {
  readonly globalRedemptions: number;
  readonly customerRedemptions: number;
}

export type CouponValidation =
  | { readonly ok: true; readonly coupon: CouponDefinition }
  | { readonly ok: false; readonly reason: CouponRejectionReason; readonly message: string };

const REJECTION_MESSAGES: Record<CouponRejectionReason, string> = {
  UNKNOWN_CODE: 'That code was not recognised.',
  INACTIVE: 'That code is no longer active.',
  NOT_YET_VALID: 'That code is not valid yet.',
  EXPIRED: 'That code has expired.',
  GLOBAL_LIMIT_REACHED: 'That code has reached its redemption limit.',
  CUSTOMER_LIMIT_REACHED: 'You have already used that code.',
  NO_ELIGIBLE_ITEMS: 'That code does not apply to anything in your order.',
  ALREADY_APPLIED: 'A discount code is already applied to this order.',
};

export function validateCoupon(
  coupon: CouponDefinition | null,
  usage: CouponUsageSnapshot,
  now: Date,
  eligibleItemCount: number,
): CouponValidation {
  const reject = (reason: CouponRejectionReason): CouponValidation => ({
    ok: false,
    reason,
    message: REJECTION_MESSAGES[reason],
  });

  if (!coupon) return reject('UNKNOWN_CODE');
  if (!coupon.active) return reject('INACTIVE');

  const nowMs = now.getTime();
  if (coupon.validFrom && nowMs < Date.parse(coupon.validFrom)) return reject('NOT_YET_VALID');
  if (coupon.validUntil && nowMs >= Date.parse(coupon.validUntil)) return reject('EXPIRED');

  if (coupon.maxRedemptions !== null && usage.globalRedemptions >= coupon.maxRedemptions) {
    return reject('GLOBAL_LIMIT_REACHED');
  }
  if (
    coupon.maxRedemptionsPerCustomer !== null &&
    usage.customerRedemptions >= coupon.maxRedemptionsPerCustomer
  ) {
    return reject('CUSTOMER_LIMIT_REACHED');
  }
  if (eligibleItemCount <= 0) return reject('NO_ELIGIBLE_ITEMS');

  return { ok: true, coupon };
}

/** Normalise user input so "  start25 " and "START25" are the same code. */
export function normaliseCouponCode(input: string): string {
  return input.trim().toUpperCase();
}
