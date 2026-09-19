import { describe, expect, it } from 'vitest';
import { usd } from '@/domain/money/money';
import {
  LIFETIME_CAP_MULTIPLE_OF_DAILY_CASH_CAP,
  PLANS,
  trailingStopFor,
  getPlan,
} from '@/domain/catalog/plans';
import {
  lifetimeCapAmountMinor,
  lifetimeCapBlocksProductionSale,
} from '@/domain/config/requirement-status';
import {
  RESET_DISCOUNT,
  checkResetEligibility,
  computeResetState,
  referencePriceForReset,
  resetPrice,
  resetPriceForKey,
  type ResetEligibilityInput,
} from '@/domain/catalog/resets';

const healthy: ResetEligibilityInput = {
  tradingStatus: 'BREACHED',
  hasPayoutInFlight: false,
  dataIsStale: false,
  isFlat: true,
  lifetimeCapReached: false,
};

describe('reset pricing', () => {
  it('is exactly $10 below the DISCOUNTED account price', () => {
    expect(RESET_DISCOUNT.value.toDecimalString()).toBe('10.00');
    for (const plan of PLANS) {
      const expected = referencePriceForReset(plan).minus(usd('10.00'));
      expect(resetPrice(plan).equals(expected)).toBe(true);
    }
  });

  it('matches the table for every account', () => {
    expect(resetPriceForKey('SIM_25K').toDecimalString()).toBe('251.75');
    expect(resetPriceForKey('SIM_50K').toDecimalString()).toBe('439.25');
    expect(resetPriceForKey('SIM_100K').toDecimalString()).toBe('739.25');
    expect(resetPriceForKey('SIM_150K').toDecimalString()).toBe('1114.25');
    expect(resetPriceForKey('SIM_300K').toDecimalString()).toBe('1864.25');
  });

  it('always undercuts the cheapest way to buy the account outright', () => {
    // The whole point: a reset a trader would never choose is not a product.
    for (const plan of PLANS) {
      expect(resetPrice(plan).lt(referencePriceForReset(plan))).toBe(true);
      expect(resetPrice(plan).lt(plan.listPrice.value)).toBe(true);
    }
  });

  it('refuses to price a reset at or below zero', () => {
    const cheap = { ...getPlan('SIM_25K'), listPrice: { ...getPlan('SIM_25K').listPrice, value: usd('12.00') } };
    expect(() => resetPrice(cheap)).toThrow(/must cost something/);
  });
});

describe('reset eligibility', () => {
  it('allows a reset on a breached account', () => {
    expect(checkResetEligibility(healthy).allowed).toBe(true);
  });

  it('refuses while the account can still trade', () => {
    const result = checkResetEligibility({ ...healthy, tradingStatus: 'ACTIVE' });
    expect(result).toMatchObject({ allowed: false, reason: 'ACCOUNT_ACTIVE' });
  });

  it('tells a daily-paused trader not to pay, because it lifts by itself', () => {
    const result = checkResetEligibility({ ...healthy, tradingStatus: 'DAILY_PAUSED' });
    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/do not need to pay/);
  });

  it('refuses while a payout is in flight', () => {
    const result = checkResetEligibility({ ...healthy, hasPayoutInFlight: true });
    expect(result).toMatchObject({ allowed: false, reason: 'PAYOUT_IN_FLIGHT' });
    expect(result.message).toMatch(/has to finish first/);
  });

  it('refuses on stale data', () => {
    expect(checkResetEligibility({ ...healthy, dataIsStale: true })).toMatchObject({
      allowed: false,
      reason: 'DATA_STALE',
    });
  });

  it('refuses while positions are open', () => {
    expect(checkResetEligibility({ ...healthy, isFlat: false })).toMatchObject({
      allowed: false,
      reason: 'NOT_FLAT',
    });
  });

  it('refuses on an account that was never provisioned', () => {
    expect(checkResetEligibility({ ...healthy, tradingStatus: 'PENDING' })).toMatchObject({
      allowed: false,
      reason: 'ACCOUNT_PENDING',
    });
  });
});

describe('reset restores the starting position', () => {
  it('returns balance, high-water and threshold to their opening values', () => {
    const plan = getPlan('SIM_50K');
    const state = computeResetState(plan, trailingStopFor(plan));
    expect(state.restoredBalance.toDecimalString()).toBe('50000.00');
    expect(state.restoredHighWater.toDecimalString()).toBe('50000.00');
    // S - D, the same threshold a freshly purchased account opens with.
    expect(state.restoredThreshold.toDecimalString()).toBe('48200.00');
  });

  it('gives the same opening threshold a new account would have', () => {
    for (const plan of PLANS) {
      const state = computeResetState(plan, trailingStopFor(plan));
      const fresh = plan.startingBalance.minus(plan.drawdownAllowance.value);
      expect(state.restoredThreshold.equals(fresh)).toBe(true);
    }
  });
});

describe('lifetime cash payout cap', () => {
  it('is exactly six times the account\'s own daily cash cap', () => {
    for (const plan of PLANS) {
      expect(plan.lifetimeCashCap.kind).toBe('approved-amount');
      if (plan.lifetimeCashCap.kind !== 'approved-amount') throw new Error('unreachable');
      const expected =
        plan.dailyCashPayoutCap.value.minor * LIFETIME_CAP_MULTIPLE_OF_DAILY_CASH_CAP;
      expect(plan.lifetimeCashCap.amountMinor).toBe(expected);
    }
  });

  it('resolves every plan, so no plan is blocked from sale by an undecided cap', () => {
    for (const plan of PLANS) {
      expect(lifetimeCapBlocksProductionSale(plan.lifetimeCashCap)).toBe(false);
      expect(lifetimeCapAmountMinor(plan.lifetimeCashCap)).toBeGreaterThan(0n);
    }
  });

  it('caps the $25K account at $6,000 and the $300K at $24,000', () => {
    const cap = (key: Parameters<typeof getPlan>[0]) => {
      const policy = getPlan(key).lifetimeCashCap;
      if (policy.kind !== 'approved-amount') throw new Error('expected an approved amount');
      return policy.amountMinor;
    };
    expect(cap('SIM_25K')).toBe(usd('6000.00').minor);
    expect(cap('SIM_300K')).toBe(usd('24000.00').minor);
  });
});

describe('reset once the lifetime cap is reached', () => {
  it('is refused, because a reset restores balance but not payout capacity', () => {
    const result = checkResetEligibility({ ...healthy, lifetimeCapReached: true });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('LIFETIME_CAP_REACHED');
    expect(result.message).toMatch(/[Bb]uy a new account/);
  });

  it('reports the ordinary blocker first when both apply', () => {
    // Telling someone to buy a new account when they simply have a position
    // open would be both wrong and expensive for them.
    const result = checkResetEligibility({
      ...healthy,
      isFlat: false,
      lifetimeCapReached: true,
    });
    expect(result.reason).toBe('NOT_FLAT');
  });
});
