import { describe, expect, it } from 'vitest';
import { Money, usd } from '@/domain/money/money';
import { allocateByWeight, allocateProportionally } from '@/domain/money/allocate';
import { MINIMUM_GROSS_WITHDRAWAL, PLANS, couponPrice, getPlan } from '@/domain/catalog/plans';
import { getPlanViews } from '@/server/views/catalog-view';
import {
  buildQuote,
  canonicaliseQuote,
  EXAMPLE_FIFTY_K_WITH_ALL_ADDONS,
  TAX_NOT_CONFIGURED,
} from '@/domain/pricing/quote';
import { DEFAULT_COUPON, normaliseCouponCode, validateCoupon } from '@/domain/pricing/coupon';
import {
  lifetimeCapAmountMinor,
  lifetimeCapBlocksProductionSale,
  type LifetimeCapPolicy,
} from '@/domain/config/requirement-status';

const coupon = DEFAULT_COUPON.value;

describe('Money', () => {
  it('parses and renders exact decimal strings', () => {
    expect(usd('599.00').minor).toBe(59900n);
    expect(usd('0.01').minor).toBe(1n);
    expect(usd('-1.5').toDecimalString()).toBe('-1.50');
    expect(usd('1499.00').format()).toBe('$1,499.00');
  });

  it('rejects precision beyond the currency scale', () => {
    expect(() => usd('1.005')).toThrow(/precision/);
  });

  it('never uses floating point for the classic 0.1 + 0.2 case', () => {
    expect(usd('0.10').plus(usd('0.20')).toDecimalString()).toBe('0.30');
    // The float equivalent would be 0.30000000000000004.
    expect(usd('0.10').plus(usd('0.20')).equals(usd('0.30'))).toBe(true);
  });

  it('rounds half-up away from zero and half-even to the even neighbour', () => {
    // 2.5 cents -> 3 half-up, 2 half-even
    expect(usd('0.05').mulRatio(1n, 2n, 'half-up').minor).toBe(3n);
    expect(usd('0.05').mulRatio(1n, 2n, 'half-even').minor).toBe(2n);
    expect(usd('-0.05').mulRatio(1n, 2n, 'half-up').minor).toBe(-3n);
  });

  it('halves exactly or refuses', () => {
    expect(usd('500.00').halfExact().equals(usd('250.00'))).toBe(true);
    expect(() => usd('5.01').halfExact()).toThrow(/fractional minor unit/);
  });

  it('floors to an increment', () => {
    expect(usd('2499.99').floorToIncrement(usd('1.00')).equals(usd('2499.00'))).toBe(true);
    expect(usd('0.50').floorToIncrement(usd('1.00')).isZero()).toBe(true);
  });
});

describe('all six 25% coupon prices match the confirmed table exactly', () => {
  const expected: Record<string, [string, string]> = {
    SIM_25K: ['349.00', '261.75'],
    SIM_50K: ['599.00', '449.25'],
    SIM_100K: ['999.00', '749.25'],
    SIM_150K: ['1499.00', '1124.25'],
    SIM_300K: ['2499.00', '1874.25'],
  };

  it.each(PLANS.map((p) => p.key))('%s', (key) => {
    const plan = getPlan(key);
    const [list, discounted] = expected[key]!;
    expect(plan.listPrice.value.toDecimalString()).toBe(list);
    expect(couponPrice(plan.listPrice.value, 25n).toDecimalString()).toBe(discounted);
  });

  it('derives the same discounted price through the quote engine, before tax', () => {
    for (const plan of PLANS) {
      const quote = buildQuote({
        selection: { planKey: plan.key, addOnKeys: [], couponCode: coupon.code },
        coupon,
      });
      // taxableTotal, not total: Michigan sales tax is added on top, so the
      // advertised price is the pre-tax figure.
      expect(quote.taxableTotal.toDecimalString()).toBe(expected[plan.key]![1]);
    }
  });
});

describe('quote composition', () => {
  it('$50K plus both risk add-ons is $509.25 before tax and $539.81 after', () => {
    const quote = buildQuote({
      selection: {
        planKey: 'SIM_50K',
        addOnKeys: ['DAILY_LOSS_UPLIFT', 'EXTRA_CONTRACTS'],
        couponCode: coupon.code,
      },
      coupon,
    });
    // 599 + 50 + 30 = 679, less 25%, plus 6%.
    expect(quote.subtotal.toDecimalString()).toBe('679.00');
    expect(quote.discountTotal.toDecimalString()).toBe('169.75');
    expect(quote.taxableTotal.toDecimalString()).toBe('509.25');
    expect(quote.total.toDecimalString()).toBe('539.81');
    expect(quote.taxableTotal.equals(EXAMPLE_FIFTY_K_WITH_ALL_ADDONS.expectedTaxableTotal)).toBe(
      true,
    );
    expect(quote.total.equals(EXAMPLE_FIFTY_K_WITH_ALL_ADDONS.expectedTotal)).toBe(true);
  });

  it('charges the same for an add-on on every account size', () => {
    // Owner decision: flat pricing. The uplift it buys is not flat — +50% of the
    // daily loss limit is $170 on the smallest account and $1,062.50 on the
    // largest — so this test is the record that the difference was intended.
    const priceOf = (planKey: 'SIM_25K' | 'SIM_300K', key: 'DAILY_LOSS_UPLIFT' | 'EXTRA_CONTRACTS') =>
      buildQuote({ selection: { planKey, addOnKeys: [key], couponCode: null }, coupon: null })
        .lines.find((line) => line.itemKey === key)!
        .lineSubtotal.toDecimalString();

    expect(priceOf('SIM_25K', 'DAILY_LOSS_UPLIFT')).toBe('50.00');
    expect(priceOf('SIM_300K', 'DAILY_LOSS_UPLIFT')).toBe('50.00');
    expect(priceOf('SIM_25K', 'EXTRA_CONTRACTS')).toBe('30.00');
    expect(priceOf('SIM_300K', 'EXTRA_CONTRACTS')).toBe('30.00');
  });

  it('no longer blocks production sale on add-on pricing, now that it is approved', () => {
    const quote = buildQuote({
      selection: { planKey: 'SIM_50K', addOnKeys: ['DAILY_LOSS_UPLIFT'], couponCode: null },
      coupon: null,
    });
    expect(quote.productionBlockers.map((b) => b.code)).not.toContain('ADDON_PRICE_PROPOSED');
  });

  it('allocates the discount across lines so the parts sum to the whole', () => {
    const quote = buildQuote({
      selection: {
        planKey: 'SIM_50K',
        addOnKeys: ['DAILY_LOSS_UPLIFT', 'EXTRA_CONTRACTS'],
        couponCode: coupon.code,
      },
      coupon,
    });
    const summed = Money.sum(quote.lines.map((l) => l.lineDiscount));
    expect(summed.equals(quote.discountTotal)).toBe(true);
    expect(quote.lines.map((l) => l.lineDiscount.toDecimalString())).toEqual([
      '149.75',
      '12.50',
      '7.50',
    ]);
    expect(quote.lines.map((l) => l.lineTotal.toDecimalString())).toEqual([
      '449.25',
      '37.50',
      '22.50',
    ]);
  });

  it('is one-time billing with no renewal', () => {
    const quote = buildQuote({ selection: { planKey: 'SIM_25K', addOnKeys: [], couponCode: null }, coupon: null });
    expect(quote.billingCadence).toBe('ONE_TIME');
  });

  it('charges list price when no coupon is applied', () => {
    const quote = buildQuote({ selection: { planKey: 'SIM_100K', addOnKeys: [], couponCode: null }, coupon: null });
    expect(quote.taxableTotal.toDecimalString()).toBe('999.00');
    expect(quote.total.toDecimalString()).toBe('1058.94');
    expect(quote.discountTotal.isZero()).toBe(true);
  });

  it('rejects duplicate add-on selections rather than double-charging', () => {
    expect(() =>
      buildQuote({
        selection: { planKey: 'SIM_25K', addOnKeys: ['EXTRA_CONTRACTS', 'EXTRA_CONTRACTS'], couponCode: null },
        coupon: null,
      }),
    ).toThrow(/more than once/);
  });

  it('rejects unknown keys instead of silently skipping them', () => {
    expect(() =>
      buildQuote({
        selection: { planKey: 'SIM_999K' as never, addOnKeys: [], couponCode: null },
        coupon: null,
      }),
    ).toThrow(/Unknown plan key/);
  });

  it('produces a canonical hashable form that changes when the price changes', () => {
    const a = buildQuote({ selection: { planKey: 'SIM_50K', addOnKeys: [], couponCode: coupon.code }, coupon });
    const b = buildQuote({ selection: { planKey: 'SIM_50K', addOnKeys: [], couponCode: null }, coupon: null });
    expect(canonicaliseQuote(a)).not.toBe(canonicaliseQuote(b));
    const aAgain = buildQuote({ selection: { planKey: 'SIM_50K', addOnKeys: [], couponCode: coupon.code }, coupon });
    expect(canonicaliseQuote(a)).toBe(canonicaliseQuote(aAgain));
  });
});

describe('discount allocation determinism', () => {
  it('sums to the total for awkward three-way splits', () => {
    // $1.00 across three equal lines cannot divide evenly.
    const parts = allocateByWeight(usd('1.00'), [1n, 1n, 1n]);
    expect(Money.sum(parts.map((p) => p.amount)).toDecimalString()).toBe('1.00');
    expect(parts.map((p) => p.amount.toDecimalString())).toEqual(['0.34', '0.33', '0.33']);
  });

  it('is stable across repeated calls, so refunds reproduce purchase-time figures', () => {
    const weights = [59900n, 1900n, 2900n, 4900n];
    const first = allocateByWeight(usd('174.00'), weights).map((p) => p.amount.toDecimalString());
    const second = allocateByWeight(usd('174.00'), weights).map((p) => p.amount.toDecimalString());
    expect(first).toEqual(second);
  });

  it('handles negative totals (refund reversal) symmetrically', () => {
    const forward = allocateProportionally(usd('174.00'), [usd('599.00'), usd('19.00')]);
    const reverse = allocateProportionally(usd('-174.00'), [usd('599.00'), usd('19.00')]);
    forward.forEach((f, i) => {
      expect(f.amount.plus(reverse[i]!.amount).isZero()).toBe(true);
    });
  });
});

describe('coupon validation', () => {
  const usage = { globalRedemptions: 0, customerRedemptions: 0 };
  const now = new Date('2026-01-01T00:00:00Z');

  it('normalises user input', () => {
    expect(normaliseCouponCode('  start25 ')).toBe('START25');
  });

  it('accepts a valid code', () => {
    expect(validateCoupon(coupon, usage, now, 1).ok).toBe(true);
  });

  it('rejects an unknown code', () => {
    const result = validateCoupon(null, usage, now, 1);
    expect(result).toMatchObject({ ok: false, reason: 'UNKNOWN_CODE' });
  });

  it('rejects an expired code', () => {
    const expired = { ...coupon, validUntil: '2025-01-01T00:00:00Z' };
    expect(validateCoupon(expired, usage, now, 1)).toMatchObject({ ok: false, reason: 'EXPIRED' });
  });

  it('rejects a code that is not valid yet', () => {
    const future = { ...coupon, validFrom: '2027-01-01T00:00:00Z' };
    expect(validateCoupon(future, usage, now, 1)).toMatchObject({ ok: false, reason: 'NOT_YET_VALID' });
  });

  it('enforces the global redemption limit', () => {
    const limited = { ...coupon, maxRedemptions: 5 };
    expect(
      validateCoupon(limited, { globalRedemptions: 5, customerRedemptions: 0 }, now, 1),
    ).toMatchObject({ ok: false, reason: 'GLOBAL_LIMIT_REACHED' });
  });

  it('keeps the advertised terms and the coupon definition in step', () => {
    // The ticker says "no expiry, no limit on uses" on every page. These three
    // nulls are that sentence, in code.
    expect(DEFAULT_COUPON.status).toBe('CONFIRMED');
    expect(coupon.validUntil).toBeNull();
    expect(coupon.maxRedemptions).toBeNull();
    expect(coupon.maxRedemptionsPerCustomer).toBeNull();
  });

  it('lets one customer use START25 again, because the owner set no per-customer limit', () => {
    expect(coupon.maxRedemptionsPerCustomer).toBeNull();
    expect(coupon.maxRedemptions).toBeNull();
    expect(coupon.validUntil).toBeNull();
    expect(
      validateCoupon(coupon, { globalRedemptions: 4_000, customerRedemptions: 9 }, now, 1),
    ).toMatchObject({ ok: true });
  });

  it('still enforces a per-customer limit when a coupon carries one', () => {
    // The mechanism is not deleted along with the limit: a future single-use
    // code has to keep working, and this is what says so.
    const limited = { ...coupon, code: 'ONEPER', maxRedemptionsPerCustomer: 1 };
    expect(
      validateCoupon(limited, { globalRedemptions: 0, customerRedemptions: 1 }, now, 1),
    ).toMatchObject({ ok: false, reason: 'CUSTOMER_LIMIT_REACHED' });
    expect(
      validateCoupon(limited, { globalRedemptions: 0, customerRedemptions: 0 }, now, 1),
    ).toMatchObject({ ok: true });
  });

  it('still enforces a global limit when a coupon carries one', () => {
    const limited = { ...coupon, code: 'FIRST100', maxRedemptions: 100 };
    expect(
      validateCoupon(limited, { globalRedemptions: 100, customerRedemptions: 0 }, now, 1),
    ).toMatchObject({ ok: false, reason: 'GLOBAL_LIMIT_REACHED' });
  });

  it('rejects when nothing in the order is eligible', () => {
    expect(validateCoupon(coupon, usage, now, 0)).toMatchObject({ ok: false, reason: 'NO_ELIGIBLE_ITEMS' });
  });

  it('is never stackable', () => {
    expect(coupon.stackable).toBe(false);
  });
});

describe('production gating', () => {
  it('blocks every plan from production sale while the policies are drafts', () => {
    // The risk numbers, the lifetime cap, the trailing policy and tax are all
    // approved now. The ten policy drafts are what still holds the gate, and
    // this is the test that says so — without it, approving the last number
    // would have opened production sale silently.
    for (const plan of PLANS) {
      const quote = buildQuote({ selection: { planKey: plan.key, addOnKeys: [], couponCode: null }, coupon: null });
      expect(quote.productionBlockers.map((b) => b.code)).toContain('POLICIES_UNAPPROVED');
    }
  });

  it('no longer blocks on the lifetime cap, now that the owner has approved one', () => {
    const quote = buildQuote({ selection: { planKey: 'SIM_50K', addOnKeys: [], couponCode: null }, coupon: null });
    expect(quote.productionBlockers.map((b) => b.code)).not.toContain(
      'PLAN_LIFETIMECASHCAP_UNRESOLVED',
    );
  });

  it('still refuses to read a usable number out of an unresolved cap', () => {
    // The guard that made the blocker above necessary has to keep working, or
    // a future plan added with no approved cap would silently sell as uncapped.
    const undecided: LifetimeCapPolicy = {
      kind: 'unresolved',
      draftMinor: usd('3000.00').minor,
      note: 'not approved',
    };
    expect(lifetimeCapBlocksProductionSale(undecided)).toBe(true);
    expect(() => lifetimeCapAmountMinor(undecided)).toThrow(/UNRESOLVED/);
  });

  it('no longer blocks on tax, now that Michigan 6% is approved', () => {
    const quote = buildQuote({ selection: { planKey: 'SIM_50K', addOnKeys: [], couponCode: null }, coupon: null });
    expect(quote.productionBlockers.map((b) => b.code)).not.toContain('TAX_UNRESOLVED');
    expect(quote.taxStatus).toBe('CONFIGURED');
  });

  it('still blocks if a quote is ever built with no tax treatment', () => {
    // The unresolved policy is retained and still gates, so removing the
    // Michigan decision would stop sales rather than silently charge zero tax.
    const quote = buildQuote({
      selection: { planKey: 'SIM_50K', addOnKeys: [], couponCode: null },
      coupon: null,
      taxPolicy: TAX_NOT_CONFIGURED,
    });
    expect(quote.productionBlockers.map((b) => b.code)).toContain('TAX_UNRESOLVED');
    expect(quote.tax.isZero()).toBe(true);
  });

  it('applies 6% to the DISCOUNTED total, so a coupon reduces the tax with the price', () => {
    const quote = buildQuote({
      selection: { planKey: 'SIM_50K', addOnKeys: [], couponCode: coupon.code },
      coupon,
    });
    expect(quote.taxableTotal.toDecimalString()).toBe('449.25');
    // 6% of 449.25 is 26.955, which rounds half-up to the cent.
    expect(quote.tax.toDecimalString()).toBe('26.96');
    expect(quote.total.toDecimalString()).toBe('476.21');
  });
});

/**
 * The worked example shown on the marketing pages.
 *
 * It scales with the account so a $300,000 account does not advertise the same
 * $500 withdrawal as the cheapest one. That is a presentation choice with real
 * constraints behind it: the example has to be a withdrawal we could actually
 * pay, in one day, under the published caps. If a future edit makes the example
 * bigger to make the page look better, these fail.
 */
describe('scaled withdrawal example', () => {
  const views = getPlanViews();

  it('shows the published minimum on the smallest account', () => {
    const smallest = views.find((view) => view.key === 'SIM_25K')!;
    expect(smallest.exampleWithdrawalGross.display).toBe('$500.00');
    expect(smallest.exampleWithdrawalCash.display).toBe('$250.00');
    expect(smallest.exampleIsMinimum).toBe(true);
  });

  it('never shows an example below the published minimum', () => {
    for (const view of views) {
      expect(Money.fromMinor(BigInt(view.exampleWithdrawalGross.minor)).gte(
        MINIMUM_GROSS_WITHDRAWAL.value,
      )).toBe(true);
    }
  });

  it('never shows an example that one day of cash capacity could not pay', () => {
    for (const view of views) {
      const cash = Money.fromMinor(BigInt(view.exampleWithdrawalCash.minor));
      const dailyCap = Money.fromMinor(BigInt(view.dailyCashCap.minor));
      expect(cash.lte(dailyCap)).toBe(true);
    }
  });

  it('never shows an example larger than one request can actually take', () => {
    // The trailing threshold has no stop, so room above it never exceeds the
    // drawdown allowance and that, not the daily cap, bounds a single request.
    // An example above it would be a withdrawal the system would refuse.
    for (const view of views) {
      const gross = Money.fromMinor(BigInt(view.exampleWithdrawalGross.minor));
      const ceiling = Money.fromMinor(BigInt(view.maxSingleWithdrawalGross.minor));
      expect(gross.lte(ceiling)).toBe(true);
    }
  });

  it('publishes a single-request ceiling below the daily cash cap on every tier', () => {
    // If this ever flips, the daily cap becomes reachable in one request and the
    // explanation on /payouts is wrong.
    for (const view of views) {
      const ceilingCash = Money.fromMinor(BigInt(view.maxSingleWithdrawalCash.minor));
      const dailyCap = Money.fromMinor(BigInt(view.dailyCashCap.minor));
      expect(ceilingCash.lt(dailyCap)).toBe(true);
    }
  });

  it('keeps the example payable: whole dollars, exactly halvable, and reachable', () => {
    for (const view of views) {
      const gross = Money.fromMinor(BigInt(view.exampleWithdrawalGross.minor));
      expect(gross.isMultipleOf(usd('1.00'))).toBe(true);
      expect(gross.halfExact().equals(Money.fromMinor(BigInt(view.exampleWithdrawalCash.minor)))).toBe(
        true,
      );
      // The balance quoted in the example must be exactly the balance that makes
      // that withdrawal available: starting balance + buffer + gross.
      const at = Money.fromMinor(BigInt(view.exampleWithdrawalAt.minor));
      const leaves = Money.fromMinor(BigInt(view.exampleWithdrawalLeaves.minor));
      expect(at.minus(gross).equals(leaves)).toBe(true);
      expect(
        leaves.equals(
          Money.fromMinor(BigInt(view.startingBalance.minor)).plus(
            Money.fromMinor(BigInt(view.retainedBuffer.minor)),
          ),
        ),
      ).toBe(true);
    }
  });

  it('grows with the account size', () => {
    const gross = views.map((view) => BigInt(view.exampleWithdrawalGross.minor));
    for (let index = 1; index < gross.length; index += 1) {
      expect(gross[index]! > gross[index - 1]!).toBe(true);
    }
  });
});
