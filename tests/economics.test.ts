import { describe, expect, it } from 'vitest';
import { usd } from '@/domain/money/money';
import { computeSensitivity, type SensitivityAssumptions } from '@/domain/economics/sensitivity';

/** The reference scenario stated in the build brief. */
const REFERENCE: SensitivityAssumptions = {
  discountedPrice: usd('449.25'),
  lifetimeVariableCosts: usd('120.00'),
  acquisitionCost: usd('0.00'),
  payoutProbabilityBps: 3000, // 30%
  conditionalAveragePayout: usd('1000.00'),
  fixedMonthlyOverhead: usd('8000.00'),
  activeAccounts: 0,
  newSalesPerMonth: 100,
  cashReserves: usd('50000.00'),
};

describe('the reference planning math from the brief', () => {
  it('gives $29.25 contribution per sale at a 30% payout probability', () => {
    const result = computeSensitivity(REFERENCE);
    expect(result.expectedPayoutCost.toDecimalString()).toBe('300.00');
    expect(result.grossMarginPerSale.toDecimalString()).toBe('329.25');
    expect(result.contributionPerSale.toDecimalString()).toBe('29.25');
  });

  it('turns NEGATIVE at a 33.3% payout probability', () => {
    const result = computeSensitivity({ ...REFERENCE, payoutProbabilityBps: 3330 });
    expect(result.expectedPayoutCost.toDecimalString()).toBe('333.00');
    expect(result.contributionPerSale.toDecimalString()).toBe('-3.75');
    expect(result.contributionPerSale.isNegative()).toBe(true);
  });

  it('identifies the probability at which contribution reaches zero', () => {
    const result = computeSensitivity(REFERENCE);
    // 329.25 / 1000 = 32.925%
    expect(result.breakEvenPayoutProbabilityBps).toBe(3292);
  });

  it('warns that the margin for error is thin', () => {
    const result = computeSensitivity(REFERENCE);
    expect(result.warnings.join(' ')).toMatch(/under five/);
  });
});

describe('overheads and break-even', () => {
  it('computes monthly profit from contribution after acquisition cost', () => {
    const result = computeSensitivity({ ...REFERENCE, acquisitionCost: usd('9.25') });
    expect(result.contributionAfterAcquisition.toDecimalString()).toBe('20.00');
    expect(result.monthlyContribution.toDecimalString()).toBe('2000.00');
    expect(result.monthlyProfit.toDecimalString()).toBe('-6000.00');
  });

  it('rounds break-even sales UP, because a partial sale does not exist', () => {
    const result = computeSensitivity({ ...REFERENCE, acquisitionCost: usd('9.25') });
    // 8000 / 20 = 400 exactly
    expect(result.breakEvenSalesPerMonth).toBe(400);

    const awkward = computeSensitivity({
      ...REFERENCE,
      acquisitionCost: usd('9.25'),
      fixedMonthlyOverhead: usd('8001.00'),
    });
    expect(awkward.breakEvenSalesPerMonth).toBe(401);
  });

  it('reports no break-even when every sale loses money', () => {
    const result = computeSensitivity({ ...REFERENCE, payoutProbabilityBps: 5000 });
    expect(result.contributionPerSale.isNegative()).toBe(true);
    expect(result.breakEvenSalesPerMonth).toBeNull();
    expect(result.warnings.join(' ')).toMatch(/loses money on every sale/);
  });
});

describe('outstanding obligations', () => {
  it('never treats active unpaid accounts as proven zero-payout outcomes', () => {
    const result = computeSensitivity({ ...REFERENCE, activeAccounts: 250 });
    // 250 accounts x $300 expected cost each.
    expect(result.expectedOutstandingObligation.toDecimalString()).toBe('75000.00');
    expect(result.warnings.join(' ')).toMatch(/not proven zero-payout outcomes/);
  });

  it('warns when the expected obligation exceeds reserves', () => {
    const result = computeSensitivity({ ...REFERENCE, activeAccounts: 250 });
    expect(result.warnings.join(' ')).toMatch(/exceeds cash reserves/);
  });

  it('computes zero-new-sales runoff months from reserves and overhead', () => {
    const result = computeSensitivity(REFERENCE);
    // $50,000 reserves / $8,000 per month, floored.
    expect(result.runoffMonths).toBe(6);
  });
});

describe('add-ons cannot rescue a loss-making base product on their own', () => {
  it('shows the base contribution separately from add-on revenue', () => {
    const loss = computeSensitivity({ ...REFERENCE, payoutProbabilityBps: 4000 });
    expect(loss.contributionPerSale.toDecimalString()).toBe('-70.75');

    // Even a generous assumed add-on margin is modelled as a separate figure,
    // never folded into the base product's contribution.
    const assumedAddOnMargin = usd('40.00');
    expect(loss.contributionPerSale.plus(assumedAddOnMargin).isNegative()).toBe(true);
  });
});

describe('input validation', () => {
  it('rejects an impossible probability', () => {
    expect(() => computeSensitivity({ ...REFERENCE, payoutProbabilityBps: 12000 })).toThrow(
      /between 0 and 10000/,
    );
  });

  it('handles a zero payout probability without inventing one', () => {
    const result = computeSensitivity({ ...REFERENCE, payoutProbabilityBps: 0 });
    expect(result.expectedPayoutCost.isZero()).toBe(true);
    expect(result.contributionPerSale.toDecimalString()).toBe('329.25');
  });
});
