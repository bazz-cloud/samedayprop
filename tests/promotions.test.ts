/**
 * Promotion economics.
 *
 * The property under test throughout: a discount does not move the lifetime
 * cap, so cutting the price raises the exposure ratio rather than reducing
 * margin. Every assertion about a ratio is checked against the published
 * figures for the $25,000 tier.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATIO_CEILING,
  applyPercentOffBps,
  chooseBestPromotion,
  discountedPrice,
  evaluatePromotion,
  lintPromotionalCopy,
  type ActivePromotion,
  type PromotionDraft,
  type TierEconomics,
} from '@/domain/promotions/promotion';

const TIERS: TierEconomics[] = [
  { planKey: 'SIM_25K', label: '$25,000', listPriceMinor: 34_900n, lifetimeCapMinor: 600_000n },
  { planKey: 'SIM_50K', label: '$50,000', listPriceMinor: 59_900n, lifetimeCapMinor: 900_000n },
  { planKey: 'SIM_300K', label: '$300,000', listPriceMinor: 249_900n, lifetimeCapMinor: 2_400_000n },
];

function draft(over: Partial<PromotionDraft> = {}): PromotionDraft {
  return {
    code: 'TEST',
    kind: 'PERCENT_OFF_ACCOUNT',
    percentOffBps: 2500,
    fixedOffMinor: 0n,
    appliesToTiers: [],
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    maxRedemptionsPerCustomer: null,
    ...over,
  };
}

describe('percentage arithmetic', () => {
  it('matches the published START25 prices exactly', () => {
    expect(applyPercentOffBps(34_900n, 2500)).toBe(26_175n); // $261.75
    expect(applyPercentOffBps(59_900n, 2500)).toBe(44_925n); // $449.25
    expect(applyPercentOffBps(249_900n, 2500)).toBe(187_425n); // $1,874.25
  });

  it('refuses a percentage outside 0-100', () => {
    expect(() => applyPercentOffBps(34_900n, 10_001)).toThrow(/basis points/);
    expect(() => applyPercentOffBps(34_900n, -1)).toThrow(/basis points/);
    expect(() => applyPercentOffBps(34_900n, 12.5)).toThrow(/basis points/);
  });
});

describe('exposure ratio under discount', () => {
  it('reproduces the published ratio table for the $25K tier', () => {
    const ratios = [0, 2500, 4000, 5000].map((bps) => {
      const evaluation = evaluatePromotion(
        draft({ percentOffBps: bps, appliesToTiers: ['SIM_25K'] }),
        TIERS,
        { ceiling: 100 },
      );
      return evaluation.impacts[0]!.discountedRatio!;
    });
    expect(ratios[0]).toBeCloseTo(17.2, 1);
    expect(ratios[1]).toBeCloseTo(22.9, 1);
    expect(ratios[2]).toBeCloseTo(28.7, 1);
    expect(ratios[3]).toBeCloseTo(34.4, 1);
  });

  it('leaves the cap untouched as the price falls', () => {
    const shallow = evaluatePromotion(draft({ percentOffBps: 1000, appliesToTiers: ['SIM_25K'] }), TIERS, { ceiling: 100 });
    const deep = evaluatePromotion(draft({ percentOffBps: 6000, appliesToTiers: ['SIM_25K'] }), TIERS, { ceiling: 100 });
    // Same cap, worse ratio. This is the whole point.
    expect(shallow.impacts[0]!.lifetimeCapMinor).toBe(deep.impacts[0]!.lifetimeCapMinor);
    expect(deep.worstRatio!).toBeGreaterThan(shallow.worstRatio!);
  });

  it('blocks a discount that pushes a tier past the ceiling', () => {
    const evaluation = evaluatePromotion(
      draft({ percentOffBps: 5000, appliesToTiers: ['SIM_25K'] }),
      TIERS,
    );
    expect(evaluation.approvable).toBe(false);
    expect(evaluation.requiresOverride).toBe(true);
    expect(evaluation.blockers.join(' ')).toMatch(/34\.4x, above the 25x ceiling/);
  });

  it('approves a discount that stays under the ceiling', () => {
    const evaluation = evaluatePromotion(
      draft({ percentOffBps: 2500, appliesToTiers: ['SIM_25K'] }),
      TIERS,
    );
    // 22.9x, just under the 25x default.
    expect(evaluation.approvable).toBe(true);
    expect(evaluation.blockers).toEqual([]);
  });

  it('degrades the $25K tier fastest, which is why tier scoping matters', () => {
    const all = evaluatePromotion(draft({ percentOffBps: 4000 }), TIERS, { ceiling: 100 });
    const byTier = new Map(all.impacts.map((i) => [i.planKey, i.discountedRatio!]));
    expect(byTier.get('SIM_25K')!).toBeGreaterThan(byTier.get('SIM_300K')!);
  });

  it('accepts an override only with a substantive typed reason', () => {
    const deep = draft({ percentOffBps: 5000, appliesToTiers: ['SIM_25K'] });
    expect(evaluatePromotion(deep, TIERS, { overrideReason: 'ok' }).approvable).toBe(false);
    expect(
      evaluatePromotion(deep, TIERS, {
        overrideReason: 'Approved for a one-week launch sale, capped at 50 redemptions.',
      }).approvable,
    ).toBe(true);
  });
});

describe('the gated kinds', () => {
  it('never approves a tier upgrade without an override, whatever the ratio', () => {
    // $261.75 for a $50K account: a $9,000 cap, so 34x AND a higher ceiling.
    const evaluation = evaluatePromotion(
      draft({ kind: 'TIER_UPGRADE', fixedOffMinor: 26_175n, appliesToTiers: ['SIM_50K'] }),
      TIERS,
      { ceiling: 100 },
    );
    expect(evaluation.approvable).toBe(false);
    expect(evaluation.blockers.join(' ')).toMatch(/raises the absolute worst case/);
  });

  it('never approves a bundle without an override', () => {
    const evaluation = evaluatePromotion(draft({ kind: 'BUNDLE' }), TIERS, { ceiling: 100 });
    expect(evaluation.approvable).toBe(false);
    expect(evaluation.blockers.join(' ')).toMatch(/correlated exposure/);
  });

  it('leaves an account fee alone for reset promotions', () => {
    // A reset buyer has already spent part of their cap, so the account's own
    // ratio is unchanged by discounting one.
    expect(discountedPrice(draft({ kind: 'PERCENT_OFF_RESET', percentOffBps: 5000 }), 34_900n)).toBe(
      34_900n,
    );
    expect(discountedPrice(draft({ kind: 'FREE_RESET' }), 34_900n)).toBe(34_900n);
  });
});

describe('validation', () => {
  it('rejects a promotion scoped to no tier', () => {
    const evaluation = evaluatePromotion(
      { ...draft(), appliesToTiers: ['SIM_150K'] },
      TIERS.filter((t) => t.planKey !== 'SIM_150K'),
    );
    expect(evaluation.blockers.join(' ')).toMatch(/applies to no tier/);
  });

  it('rejects an end time that is not after the start', () => {
    const when = new Date('2026-10-01T00:00:00Z');
    const evaluation = evaluatePromotion(
      draft({ startsAt: when, endsAt: when, appliesToTiers: ['SIM_25K'] }),
      TIERS,
    );
    expect(evaluation.blockers.join(' ')).toMatch(/not after the start/);
  });

  it('refuses to price a tier whose cap is unresolved', () => {
    const evaluation = evaluatePromotion(draft({ appliesToTiers: ['SIM_25K'] }), [
      { planKey: 'SIM_25K', label: '$25,000', listPriceMinor: 34_900n, lifetimeCapMinor: null },
    ]);
    expect(evaluation.blockers.join(' ')).toMatch(/no approved lifetime cap/);
    expect(evaluation.worstRatio).toBeNull();
  });

  it('rejects a fixed discount that takes the price to nothing', () => {
    const evaluation = evaluatePromotion(
      draft({ kind: 'FIXED_OFF_ACCOUNT', fixedOffMinor: 40_000n, appliesToTiers: ['SIM_25K'] }),
      TIERS,
    );
    expect(evaluation.blockers.join(' ')).toMatch(/sell for nothing/);
  });
});

describe('choosing a promotion at checkout', () => {
  const promo = (over: Partial<ActivePromotion>): ActivePromotion => ({
    id: over.code ?? 'p',
    code: 'A',
    kind: 'PERCENT_OFF_ACCOUNT',
    percentOffBps: 1000,
    fixedOffMinor: 0n,
    appliesToTiers: [],
    startsAt: null,
    endsAt: null,
    ...over,
  });

  const now = new Date('2026-10-01T12:00:00Z');

  it('never stacks: the single best discount wins', () => {
    const choice = chooseBestPromotion({
      planKey: 'SIM_25K',
      listPriceMinor: 34_900n,
      candidates: [
        promo({ code: 'TEN', percentOffBps: 1000 }),
        promo({ code: 'TWENTYFIVE', percentOffBps: 2500 }),
      ],
      now,
    });
    expect(choice.promotion!.code).toBe('TWENTYFIVE');
    // 25% off, not 35% off.
    expect(choice.discountedPriceMinor).toBe(26_175n);
    expect(choice.rejected.some((r) => r.code === 'TEN')).toBe(true);
  });

  it('breaks ties deterministically, so a refund reproduces the purchase price', () => {
    const run = () =>
      chooseBestPromotion({
        planKey: 'SIM_25K',
        listPriceMinor: 34_900n,
        candidates: [promo({ code: 'ZULU' }), promo({ code: 'ALPHA' })],
        now,
      }).promotion!.code;
    expect(run()).toBe('ALPHA');
    expect(run()).toBe('ALPHA');
  });

  it('honours absolute start and end instants', () => {
    const ended = chooseBestPromotion({
      planKey: 'SIM_25K',
      listPriceMinor: 34_900n,
      candidates: [promo({ code: 'OVER', endsAt: new Date('2026-10-01T11:59:59Z') })],
      now,
    });
    expect(ended.promotion).toBeNull();
    expect(ended.discountedPriceMinor).toBe(34_900n);
    expect(ended.rejected[0]!.reason).toBe('Ended.');
  });

  it('treats the end instant as exclusive', () => {
    const exactly = chooseBestPromotion({
      planKey: 'SIM_25K',
      listPriceMinor: 34_900n,
      candidates: [promo({ code: 'EDGE', endsAt: now })],
      now,
    });
    expect(exactly.promotion).toBeNull();
  });

  it('skips a promotion scoped to other tiers', () => {
    const choice = chooseBestPromotion({
      planKey: 'SIM_25K',
      listPriceMinor: 34_900n,
      candidates: [promo({ code: 'BIGONLY', appliesToTiers: ['SIM_300K'], percentOffBps: 5000 })],
      now,
    });
    expect(choice.promotion).toBeNull();
  });

  it('never applies a reset promotion to an account fee', () => {
    const choice = chooseBestPromotion({
      planKey: 'SIM_25K',
      listPriceMinor: 34_900n,
      candidates: [promo({ code: 'RESET50', kind: 'PERCENT_OFF_RESET', percentOffBps: 5000 })],
      now,
    });
    expect(choice.promotion).toBeNull();
    expect(choice.rejected[0]!.reason).toMatch(/resets, not to an account fee/);
  });
});

describe('promotional copy linter', () => {
  it('flags earnings claims', () => {
    expect(lintPromotionalCopy('Earn $10,000 a month').map((f) => f.severity)).toContain(
      'EARNINGS_CLAIM',
    );
    expect(lintPromotionalCopy('Replace your salary trading futures').map((f) => f.severity)).toContain(
      'EARNINGS_CLAIM',
    );
  });

  it('flags guarantees', () => {
    expect(lintPromotionalCopy('Guaranteed payouts, risk-free').map((f) => f.severity)).toContain(
      'GUARANTEE',
    );
  });

  it('flags copy implying real brokerage funds', () => {
    expect(lintPromotionalCopy('Trade our capital today').map((f) => f.severity)).toContain(
      'IMPLIES_REAL_FUNDS',
    );
    expect(lintPromotionalCopy('Become a funded trader').map((f) => f.severity)).toContain(
      'IMPLIES_REAL_FUNDS',
    );
  });

  it('passes accurate copy', () => {
    expect(lintPromotionalCopy('25% off a simulated account. No evaluation.')).toEqual([]);
  });
});

describe('the default ceiling', () => {
  it('sits above START25 so the live promotion is not retroactively blocked', () => {
    expect(DEFAULT_RATIO_CEILING).toBeGreaterThan(22.9);
  });
});
