/**
 * Server-side quote calculation.
 *
 * Every price the customer ever sees comes from here, computed from the trusted
 * catalog. The browser sends only *selections* (a plan key, add-on keys, a
 * coupon code); it never sends prices, and a tampered payload cannot change
 * what is charged.
 *
 * The resulting `Quote` is canonicalised and hashed by the server layer, and
 * the customer's signature is bound to that hash — so a plan, rule or price
 * change between signing and charging invalidates the quote rather than
 * silently charging different terms.
 */

import { Money, usd, USD, type Currency } from '../money/money';
import { allocateProportionally } from '../money/allocate';
import { getAddOn, isAddOnKey, type AddOnKey } from '../catalog/addons';
import { getPlan, isPlanKey, planLaunchBlockers, type PlanKey } from '../catalog/plans';
import { confirmed, unresolved, type Governed } from '../config/requirement-status';
import { POLICY_DRAFTS, policiesBlockProductionSale } from '../policy/policies';
import type { CouponDefinition } from './coupon';

export type QuoteLineKind = 'ACCOUNT_PLAN' | 'ADDON';

export interface QuoteSelection {
  readonly planKey: PlanKey;
  readonly addOnKeys: readonly AddOnKey[];
  readonly couponCode: string | null;
}

export interface QuoteLine {
  readonly kind: QuoteLineKind;
  /** PlanKey or AddOnKey. */
  readonly itemKey: string;
  readonly name: string;
  readonly quantity: number;
  /** Catalog list price for one unit, before any discount. */
  readonly unitListPrice: Money;
  /** unitListPrice * quantity. */
  readonly lineSubtotal: Money;
  /** Portion of the order discount allocated to this line. */
  readonly lineDiscount: Money;
  /** lineSubtotal - lineDiscount. The taxable amount for this line. */
  readonly lineTotal: Money;
  readonly couponEligible: boolean;
}

/**
 * Tax treatment was NOT supplied. We do not guess a jurisdiction, a rate, or
 * whether prices are tax-inclusive — inventing any of those would be inventing
 * a commercial term. The default policy contributes zero and marks the quote as
 * tax-unconfigured, which blocks production checkout.
 */
export interface TaxPolicy {
  readonly kind: 'NOT_CONFIGURED' | 'CONFIGURED';
  readonly description: string;
  /** Returns the tax due on the post-discount total. */
  computeTax(taxableTotal: Money): Money;
}

/**
 * Michigan sales tax, 6%, exclusive.
 *
 * OWNER DECISION, 2026-09-19. Applied to the post-discount total, so a coupon
 * reduces the tax with the price, and rounded half-up to the cent on the whole
 * order rather than per line — one taxable amount, one rounding.
 *
 * TWO THINGS THE OWNER'S ACCOUNTANT HAS TO CONFIRM, recorded here because the
 * code cannot settle either one:
 *
 *  1. WHETHER THIS FEE IS TAXABLE AT ALL. Michigan taxes tangible personal
 *     property and prewritten computer software delivered electronically; it
 *     does not tax most services. Access to a simulated trading account is not
 *     obviously any of those.
 *  2. WHOSE RATE APPLIES. Sales tax is normally destination-based: a Michigan
 *     seller does not usually charge Michigan tax to a buyer in another state,
 *     and may owe that state's tax instead once nexus thresholds are crossed.
 *     This policy charges 6% on every order regardless of where the buyer is,
 *     which is what was asked for. Switching to destination-based means reading
 *     the buyer's region at checkout, which the profile already stores.
 *
 * Neither caveat blocks the sale; both are in docs/OPEN_ITEMS.md.
 */
export const MICHIGAN_SALES_TAX: Governed<TaxPolicy> = confirmed(
  {
    kind: 'CONFIGURED',
    description: 'Michigan sales tax of 6% is added to the discounted total.',
    computeTax: (taxableTotal: Money) => taxableTotal.mulRatio(6n, 100n, 'half-up'),
  },
  'Michigan sales tax, 6%, added on top of the discounted total.',
  'Owner decision 2026-09-19',
);

export const TAX_NOT_CONFIGURED: Governed<TaxPolicy> = unresolved(
  {
    kind: 'NOT_CONFIGURED',
    description:
      'No tax jurisdiction, rate or inclusive/exclusive treatment has been supplied. ' +
      'Displayed totals exclude any tax that may apply.',
    computeTax: (taxableTotal: Money) => Money.zero(taxableTotal.currency),
  },
  'Tax treatment is unresolved and blocks production checkout.',
  'Build prompt §8 — do not silently select tax treatment',
);

export interface QuoteInput {
  readonly selection: QuoteSelection;
  /** Already validated against usage limits and validity window, or null. */
  readonly coupon: CouponDefinition | null;
  readonly taxPolicy?: Governed<TaxPolicy>;
  readonly currency?: Currency;
}

export interface QuoteBlocker {
  readonly code: string;
  readonly detail: string;
}

export interface Quote {
  readonly currency: Currency;
  readonly lines: readonly QuoteLine[];
  /** Sum of list prices before any discount. */
  readonly subtotal: Money;
  /** Total discount, equal to the sum of every line discount. */
  readonly discountTotal: Money;
  readonly couponCode: string | null;
  readonly couponPercentOff: bigint | null;
  /** subtotal - discountTotal. */
  readonly taxableTotal: Money;
  readonly tax: Money;
  readonly taxStatus: TaxPolicy['kind'];
  readonly taxDescription: string;
  /** taxableTotal + tax. The exact amount that will be charged. */
  readonly total: Money;
  /** Reasons this quote may not be charged in production. */
  readonly productionBlockers: readonly QuoteBlocker[];
  readonly billingCadence: 'ONE_TIME';
}

export function buildQuote(input: QuoteInput): Quote {
  const currency = input.currency ?? USD;
  const taxPolicyGoverned = input.taxPolicy ?? MICHIGAN_SALES_TAX;
  const taxPolicy = taxPolicyGoverned.value;

  if (!isPlanKey(input.selection.planKey)) {
    throw new Error(`Unknown plan key ${input.selection.planKey}`);
  }
  const plan = getPlan(input.selection.planKey);

  // Reject duplicates rather than silently collapsing or double-charging.
  const seen = new Set<string>();
  for (const key of input.selection.addOnKeys) {
    if (!isAddOnKey(key)) throw new Error(`Unknown add-on key ${key}`);
    if (seen.has(key)) throw new Error(`Add-on ${key} selected more than once`);
    seen.add(key);
  }

  const rawLines: Omit<QuoteLine, 'lineDiscount' | 'lineTotal'>[] = [
    {
      kind: 'ACCOUNT_PLAN',
      itemKey: plan.key,
      name: `${plan.label} simulated account`,
      quantity: 1,
      unitListPrice: plan.listPrice.value,
      lineSubtotal: plan.listPrice.value,
      couponEligible: true,
    },
    ...input.selection.addOnKeys.map((key) => {
      const addon = getAddOn(key);
      const price = addon.listPrice.value;
      return {
        kind: 'ADDON' as const,
        itemKey: addon.key,
        name: addon.name,
        quantity: 1,
        unitListPrice: price,
        lineSubtotal: price,
        couponEligible: addon.couponEligible,
      };
    }),
  ];

  const subtotal = Money.sum(
    rawLines.map((l) => l.lineSubtotal),
    currency,
  );

  // ---- discount -----------------------------------------------------------
  // The coupon applies to the eligible subtotal, and the resulting discount is
  // allocated back across only those eligible lines. Allocating from a single
  // rounded order-level figure (rather than rounding each line independently)
  // is what keeps the parts summing exactly to the whole.
  const eligibleIndexes: number[] = [];
  rawLines.forEach((line, index) => {
    if (!input.coupon) return;
    if (!line.couponEligible) return;
    if (input.coupon.scope === 'ACCOUNT_PLANS' && line.kind !== 'ACCOUNT_PLAN') return;
    if (input.coupon.scope === 'ADDONS' && line.kind !== 'ADDON') return;
    eligibleIndexes.push(index);
  });

  const lineDiscounts = rawLines.map(() => Money.zero(currency));
  let discountTotal = Money.zero(currency);

  if (input.coupon && eligibleIndexes.length > 0) {
    const eligibleSubtotal = Money.sum(
      eligibleIndexes.map((i) => rawLines[i]!.lineSubtotal),
      currency,
    );
    discountTotal = eligibleSubtotal.mulRatio(input.coupon.percentOff, 100n, 'half-up');
    const allocations = allocateProportionally(
      discountTotal,
      eligibleIndexes.map((i) => rawLines[i]!.lineSubtotal),
    );
    for (const allocation of allocations) {
      lineDiscounts[eligibleIndexes[allocation.index]!] = allocation.amount;
    }
  }

  const lines: QuoteLine[] = rawLines.map((line, index) => {
    const lineDiscount = lineDiscounts[index]!;
    return { ...line, lineDiscount, lineTotal: line.lineSubtotal.minus(lineDiscount) };
  });

  const taxableTotal = subtotal.minus(discountTotal);
  const tax = taxPolicy.computeTax(taxableTotal);
  const total = taxableTotal.plus(tax);

  // ---- production gating --------------------------------------------------
  const productionBlockers: QuoteBlocker[] = [];

  // The ten trading and account policies gate a production sale just as the
  // risk numbers do. They were NOT wired in before, which only became visible
  // once tax and the trailing policy were approved and every other blocker
  // cleared — at which point a quote would have reported itself sellable while
  // the policies governing conduct, refunds and closure were still drafts.
  if (policiesBlockProductionSale()) {
    const pending = POLICY_DRAFTS.filter((policy) => policy.status !== 'CONFIRMED');
    productionBlockers.push({
      code: 'POLICIES_UNAPPROVED',
      detail:
        `${pending.length} trading and account ${pending.length === 1 ? 'policy is' : 'policies are'} ` +
        `still awaiting approval: ${pending.map((policy) => policy.value.title).join(', ')}.`,
    });
  }

  for (const blocker of planLaunchBlockers(plan)) {
    productionBlockers.push({
      code: `PLAN_${blocker.field.toUpperCase()}_${blocker.status}`,
      detail: `${plan.label}: ${blocker.detail}`,
    });
  }

  for (const key of input.selection.addOnKeys) {
    const addon = getAddOn(key);
    if (addon.listPrice.status !== 'CONFIRMED') {
      productionBlockers.push({
        code: `ADDON_PRICE_${addon.listPrice.status}`,
        detail: `${addon.name} pricing is ${addon.listPrice.status} and not approved for sale.`,
      });
    }
  }

  if (taxPolicyGoverned.status !== 'CONFIRMED') {
    productionBlockers.push({
      code: `TAX_${taxPolicyGoverned.status}`,
      detail: taxPolicy.description,
    });
  }

  return {
    currency,
    lines,
    subtotal,
    discountTotal,
    couponCode: input.coupon?.code ?? null,
    couponPercentOff: input.coupon?.percentOff ?? null,
    taxableTotal,
    tax,
    taxStatus: taxPolicy.kind,
    taxDescription: taxPolicy.description,
    total,
    productionBlockers,
    billingCadence: 'ONE_TIME',
  };
}

/**
 * Canonical, stable serialisation of everything the customer is agreeing to.
 *
 * The server hashes this string and stores the hash on the quote, the signature
 * and the order. Any change to a price, a line, the coupon or the total
 * produces a different hash, which invalidates an in-flight signature.
 */
export function canonicaliseQuote(quote: Quote): string {
  const payload = {
    v: 1,
    currency: quote.currency,
    billingCadence: quote.billingCadence,
    couponCode: quote.couponCode,
    couponPercentOff: quote.couponPercentOff?.toString() ?? null,
    lines: quote.lines.map((line) => ({
      kind: line.kind,
      itemKey: line.itemKey,
      quantity: line.quantity,
      unitListPrice: line.unitListPrice.minor.toString(),
      lineSubtotal: line.lineSubtotal.minor.toString(),
      lineDiscount: line.lineDiscount.minor.toString(),
      lineTotal: line.lineTotal.minor.toString(),
    })),
    subtotal: quote.subtotal.minor.toString(),
    discountTotal: quote.discountTotal.minor.toString(),
    taxableTotal: quote.taxableTotal.minor.toString(),
    tax: quote.tax.minor.toString(),
    taxStatus: quote.taxStatus,
    total: quote.total.minor.toString(),
  };
  return JSON.stringify(payload);
}

/** Refund allocation for a single line, derived from the stored quote. */
export function refundAllocationForLine(quote: Quote, itemKey: string): Money {
  const line = quote.lines.find((l) => l.itemKey === itemKey);
  if (!line) throw new Error(`Line ${itemKey} is not part of this quote`);
  // The customer paid lineTotal for this line plus its deterministic share of
  // tax; refunding lineTotal reverses exactly what was allocated to it.
  return line.lineTotal;
}

export const EXAMPLE_FIFTY_K_WITH_ALL_ADDONS = {
  description:
    '$50,000 account plus both risk add-ons with the 25% coupon, then 6% Michigan sales tax',
  arithmetic: '(599 + 50 + 30) * 0.75 * 1.06',
  expectedTaxableTotal: usd('509.25'),
  expectedTotal: usd('539.81'),
} as const;
