import { describe, expect, it } from 'vitest';
import { Money, usd } from '@/domain/money/money';
import { allocateByWeight, allocateProportionally } from '@/domain/money/allocate';
import { PLANS, couponPrice, getPlan } from '@/domain/catalog/plans';
import { buildQuote, canonicaliseQuote } from '@/domain/pricing/quote';
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

  it('derives the same discounted price through the quote engine', () => {
    for (const plan of PLANS) {
      const quote = buildQuote({
        selection: { planKey: plan.key, addOnKeys: [], couponCode: coupon.code },
        coupon,
      });
      expect(quote.total.toDecimalString()).toBe(
        expected[plan.key]![1],
      );
    }
  });
});

describe('quote composition', () => {
  it('$50K plus all candidate add-ons is exactly $522.00 before applicable tax', () => {
    const quote = buildQuote({
      selection: {
        planKey: 'SIM_50K',
        addOnKeys: ['JOURNAL_KIT', 'ADVANCED_ANALYTICS', 'GUIDED_SETUP'],
        couponCode: coupon.code,
      },
      coupon,
    });
    expect(quote.subtotal.toDecimalString()).toBe('696.00');
    expect(quote.discountTotal.toDecimalString()).toBe('174.00');
    expect(quote.taxableTotal.toDecimalString()).toBe('522.00');
    expect(quote.tax.isZero()).toBe(true);
    expect(quote.total.toDecimalString()).toBe('522.00');
  });

  it('allocates the discount across lines so the parts sum to the whole', () => {
    const quote = buildQuote({
      selection: {
        planKey: 'SIM_50K',
        addOnKeys: ['JOURNAL_KIT', 'ADVANCED_ANALYTICS', 'GUIDED_SETUP'],
        couponCode: coupon.code,
      },
      coupon,
    });
    const summed = Money.sum(quote.lines.map((l) => l.lineDiscount));
    expect(summed.equals(quote.discountTotal)).toBe(true);
    expect(quote.lines.map((l) => l.lineDiscount.toDecimalString())).toEqual([
      '149.75',
      '4.75',
      '7.25',
      '12.25',
    ]);
    expect(quote.lines.map((l) => l.lineTotal.toDecimalString())).toEqual([
      '449.25',
      '14.25',
      '21.75',
      '36.75',
    ]);
  });

  it('is one-time billing with no renewal', () => {
    const quote = buildQuote({ selection: { planKey: 'SIM_25K', addOnKeys: [], couponCode: null }, coupon: null });
    expect(quote.billingCadence).toBe('ONE_TIME');
  });

  it('charges list price when no coupon is applied', () => {
    const quote = buildQuote({ selection: { planKey: 'SIM_100K', addOnKeys: [], couponCode: null }, coupon: null });
    expect(quote.total.toDecimalString()).toBe('999.00');
    expect(quote.discountTotal.isZero()).toBe(true);
  });

  it('rejects duplicate add-on selections rather than double-charging', () => {
    expect(() =>
      buildQuote({
        selection: { planKey: 'SIM_25K', addOnKeys: ['JOURNAL_KIT', 'JOURNAL_KIT'], couponCode: null },
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

  it('enforces the per-customer redemption limit', () => {
    expect(
      validateCoupon(coupon, { globalRedemptions: 0, customerRedemptions: 1 }, now, 1),
    ).toMatchObject({ ok: false, reason: 'CUSTOMER_LIMIT_REACHED' });
  });

  it('rejects when nothing in the order is eligible', () => {
    expect(validateCoupon(coupon, usage, now, 0)).toMatchObject({ ok: false, reason: 'NO_ELIGIBLE_ITEMS' });
  });

  it('is never stackable', () => {
    expect(coupon.stackable).toBe(false);
  });
});

describe('production gating', () => {
  it('blocks every plan from production sale while risk terms are unapproved', () => {
    for (const plan of PLANS) {
      const quote = buildQuote({ selection: { planKey: plan.key, addOnKeys: [], couponCode: null }, coupon: null });
      expect(quote.productionBlockers.length).toBeGreaterThan(0);
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

  it('blocks on unconfigured tax rather than assuming zero tax is correct', () => {
    const quote = buildQuote({ selection: { planKey: 'SIM_50K', addOnKeys: [], couponCode: null }, coupon: null });
    expect(quote.productionBlockers.map((b) => b.code)).toContain('TAX_UNRESOLVED');
  });
});
