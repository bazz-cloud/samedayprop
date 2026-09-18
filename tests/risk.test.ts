import { describe, expect, it } from 'vitest';
import { Money, usd } from '@/domain/money/money';
import { getPlan, TRAILING_STOP_OFFSET } from '@/domain/catalog/plans';
import {
  applyEquityObservation,
  applyWithdrawalDeduction,
  computeThreshold,
  initialTrailingState,
  isTrailingBreached,
  remainingTrailingRoom,
  type TrailingParams,
} from '@/domain/risk/trailing';
import {
  dailyLossRemaining,
  dailyLossUsed,
  isDailyLossBreached,
  openSession,
  recordWithdrawalDeduction,
  sessionTradingPnl,
} from '@/domain/risk/daily-loss';
import {
  ceilingToMicroEquivalents,
  computeExposure,
  evaluateNewOrder,
  UnknownProductError,
  type ProductSpec,
  type WorkingOrderLike,
} from '@/domain/risk/exposure';

const plan = getPlan('SIM_50K');
const params: TrailingParams = {
  startingBalance: plan.startingBalance,
  drawdownAllowance: plan.drawdownAllowance.value,
  stopOffset: TRAILING_STOP_OFFSET.value,
};

describe('intraday trailing drawdown', () => {
  it('starts at S - D', () => {
    const state = initialTrailingState(params);
    expect(state.highWater.toDecimalString()).toBe('50000.00');
    expect(state.threshold.toDecimalString()).toBe('48000.00');
    expect(state.thresholdIsCapped).toBe(false);
  });

  it('rises on an UNREALIZED intraday peak, not only on closed trades', () => {
    let state = initialTrailingState(params);
    // Open position marks up to 50,800 without being closed.
    state = applyEquityObservation(params, state, usd('50800.00'));
    expect(state.highWater.toDecimalString()).toBe('50800.00');
    expect(state.threshold.toDecimalString()).toBe('48800.00');
  });

  it('never lowers the threshold when the peak is given back', () => {
    let state = initialTrailingState(params);
    state = applyEquityObservation(params, state, usd('51500.00'));
    const peakThreshold = state.threshold;
    state = applyEquityObservation(params, state, usd('50100.00'));
    expect(state.highWater.toDecimalString()).toBe('51500.00');
    expect(state.threshold.equals(peakThreshold)).toBe(true);
    expect(state.threshold.toDecimalString()).toBe('49500.00');
  });

  it('stops rising at starting balance + $100', () => {
    let state = initialTrailingState(params);
    state = applyEquityObservation(params, state, usd('52100.00'));
    expect(state.threshold.toDecimalString()).toBe('50100.00');
    expect(state.thresholdIsCapped).toBe(true);

    // Further gains do not push the threshold past the cap.
    state = applyEquityObservation(params, state, usd('99000.00'));
    expect(state.threshold.toDecimalString()).toBe('50100.00');
  });

  it('never moves the threshold down after a withdrawal', () => {
    let state = initialTrailingState(params);
    state = applyEquityObservation(params, state, usd('52500.00'));
    expect(state.threshold.toDecimalString()).toBe('50100.00');

    // $500 gross withdrawal: equity falls to 52,000, threshold holds.
    state = applyWithdrawalDeduction(state);
    state = applyEquityObservation(params, state, usd('52000.00'));
    expect(state.threshold.toDecimalString()).toBe('50100.00');
    expect(state.highWater.toDecimalString()).toBe('52500.00');
  });

  it('matches the worked example: threshold 50,100 with 52,000 equity leaves 1,900 room', () => {
    let state = initialTrailingState(params);
    state = applyEquityObservation(params, state, usd('52500.00'));
    state = applyEquityObservation(params, state, usd('52000.00'));
    expect(state.threshold.toDecimalString()).toBe('50100.00');
    expect(remainingTrailingRoom(state, usd('52000.00')).toDecimalString()).toBe('1900.00');
  });

  it('breaches when equity touches the threshold, not only when it goes below', () => {
    const state = initialTrailingState(params);
    expect(isTrailingBreached(state, usd('48000.01'))).toBe(false);
    expect(isTrailingBreached(state, usd('48000.00'))).toBe(true);
    expect(isTrailingBreached(state, usd('47999.99'))).toBe(true);
  });

  it('is monotonic under an arbitrary equity walk', () => {
    let state = initialTrailingState(params);
    let previousHigh = state.highWater;
    let previousThreshold = state.threshold;
    const walk = ['50500', '49800', '51200', '48900', '52300', '50050', '52900', '51000'];
    for (const value of walk) {
      state = applyEquityObservation(params, state, usd(`${value}.00`));
      expect(state.highWater.gte(previousHigh)).toBe(true);
      expect(state.threshold.gte(previousThreshold)).toBe(true);
      previousHigh = state.highWater;
      previousThreshold = state.threshold;
    }
  });

  it('computes the threshold as min(S + stop, H - D)', () => {
    expect(computeThreshold(params, usd('50000.00')).toDecimalString()).toBe('48000.00');
    expect(computeThreshold(params, usd('51000.00')).toDecimalString()).toBe('49000.00');
    expect(computeThreshold(params, usd('60000.00')).toDecimalString()).toBe('50100.00');
  });
});

describe('daily loss limit', () => {
  const limit = plan.dailyLossLimit.value; // $700

  it('measures realized plus unrealized session P&L', () => {
    const state = openSession('2026-01-15', usd('50000.00'));
    expect(sessionTradingPnl(state, usd('50450.00')).toDecimalString()).toBe('450.00');
    expect(sessionTradingPnl(state, usd('49550.00')).toDecimalString()).toBe('-450.00');
  });

  it('reports zero usage while the session is profitable', () => {
    const state = openSession('2026-01-15', usd('50000.00'));
    expect(dailyLossUsed(state, usd('50450.00')).isZero()).toBe(true);
    expect(dailyLossRemaining(state, usd('50450.00'), limit).toDecimalString()).toBe('700.00');
  });

  it('EXCLUDES withdrawal deductions from daily trading P&L', () => {
    let state = openSession('2026-01-15', usd('52500.00'));
    // Trader withdraws $2,000 gross, then trades flat.
    state = recordWithdrawalDeduction(state, usd('2000.00'));
    const equityAfter = usd('50500.00');

    // Equity fell by 2,000 but no trading loss occurred.
    expect(sessionTradingPnl(state, equityAfter).isZero()).toBe(true);
    expect(dailyLossUsed(state, equityAfter).isZero()).toBe(true);
    expect(isDailyLossBreached(state, equityAfter, limit)).toBe(false);
  });

  it('still counts a real trading loss that happens alongside a withdrawal', () => {
    let state = openSession('2026-01-15', usd('52500.00'));
    state = recordWithdrawalDeduction(state, usd('2000.00'));
    // Withdrew 2,000 and lost 300 trading.
    const equityAfter = usd('50200.00');
    expect(sessionTradingPnl(state, equityAfter).toDecimalString()).toBe('-300.00');
    expect(dailyLossUsed(state, equityAfter).toDecimalString()).toBe('300.00');
    expect(dailyLossRemaining(state, equityAfter, limit).toDecimalString()).toBe('400.00');
  });

  it('breaches when the loss reaches the limit exactly', () => {
    const state = openSession('2026-01-15', usd('50000.00'));
    expect(isDailyLossBreached(state, usd('49300.01'), limit)).toBe(false);
    expect(isDailyLossBreached(state, usd('49300.00'), limit)).toBe(true);
  });

  it('does not double-count commissions already reflected in equity', () => {
    // Equity of 49,900 is already net of a $10 commission on a $90 gross loss.
    const state = openSession('2026-01-15', usd('50000.00'));
    expect(dailyLossUsed(state, usd('49900.00')).toDecimalString()).toBe('100.00');
  });

  it('clamps remaining allowance at zero rather than reporting a negative', () => {
    const state = openSession('2026-01-15', usd('50000.00'));
    expect(dailyLossRemaining(state, usd('48000.00'), limit).toDecimalString()).toBe('0.00');
  });

  it('resets on a new session', () => {
    const day1 = openSession('2026-01-15', usd('50000.00'));
    expect(dailyLossUsed(day1, usd('49400.00')).toDecimalString()).toBe('600.00');
    const day2 = openSession('2026-01-16', usd('49400.00'));
    expect(dailyLossUsed(day2, usd('49400.00')).isZero()).toBe(true);
    expect(dailyLossRemaining(day2, usd('49400.00'), limit).toDecimalString()).toBe('700.00');
  });
});

describe('position exposure', () => {
  const products = new Map<string, ProductSpec>([
    ['ES', { symbol: 'ES', nettingGroup: 'EQUITY_INDEX_SP', microEquivalentsPerContract: 10, approved: true, description: 'E-mini S&P 500' }],
    ['MES', { symbol: 'MES', nettingGroup: 'EQUITY_INDEX_SP', microEquivalentsPerContract: 1, approved: true, description: 'Micro E-mini S&P 500' }],
    ['NQ', { symbol: 'NQ', nettingGroup: 'EQUITY_INDEX_NASDAQ', microEquivalentsPerContract: 10, approved: true, description: 'E-mini Nasdaq-100' }],
    ['CL', { symbol: 'CL', nettingGroup: 'ENERGY_CRUDE', microEquivalentsPerContract: 10, approved: false, description: 'Crude oil — risk controls not approved' }],
  ]);
  const cap = ceilingToMicroEquivalents(plan.positionCeiling.value); // 40

  const order = (o: Partial<WorkingOrderLike> & { symbol: string; signedQuantity: number }): WorkingOrderLike => ({
    intent: 'INCREASE',
    ocoGroupId: null,
    ...o,
  });

  it('converts the confirmed ceiling to a single combined cap', () => {
    expect(cap).toBe(40);
    expect(ceilingToMicroEquivalents(getPlan('SIM_100K').positionCeiling.value)).toBe(60);
  });

  it('rejects an internally inconsistent ceiling instead of guessing', () => {
    expect(() => ceilingToMicroEquivalents({ minis: 4, micros: 50 })).toThrow(/inconsistent/);
  });

  it('treats 4 minis and 40 micros as the same exposure', () => {
    const asMinis = computeExposure([{ symbol: 'ES', signedQuantity: 4 }], [], products);
    const asMicros = computeExposure([{ symbol: 'MES', signedQuantity: 40 }], [], products);
    expect(asMinis.totalWorstCase).toBe(40);
    expect(asMicros.totalWorstCase).toBe(40);
  });

  it('counts a mixed mini/micro position against one combined cap', () => {
    // 2 minis (20) + 15 micros (15) = 35, still under 40.
    const result = computeExposure(
      [{ symbol: 'ES', signedQuantity: 2 }, { symbol: 'MES', signedQuantity: 15 }],
      [],
      products,
    );
    expect(result.totalWorstCase).toBe(35);
    expect(
      evaluateNewOrder(
        [{ symbol: 'ES', signedQuantity: 2 }, { symbol: 'MES', signedQuantity: 15 }],
        [],
        order({ symbol: 'MES', signedQuantity: 6 }),
        products,
        cap,
      ).allowed,
    ).toBe(false);
  });

  it('counts PENDING orders so two racing submissions cannot both slip under the cap', () => {
    const positions = [{ symbol: 'ES', signedQuantity: 2 }]; // 20 used
    const firstWorking = [order({ symbol: 'ES', signedQuantity: 2 })]; // 20 pending, total 40

    // Each order alone fits. Together they do not.
    expect(evaluateNewOrder(positions, [], order({ symbol: 'ES', signedQuantity: 2 }), products, cap).allowed).toBe(true);
    const second = evaluateNewOrder(positions, firstWorking, order({ symbol: 'ES', signedQuantity: 2 }), products, cap);
    expect(second.allowed).toBe(false);
    expect(second.projectedMicroEquivalents).toBe(60);
    expect(second.reason).toMatch(/working entry order/);
  });

  it('charges an OCO bracket only its largest leg', () => {
    const positions = [{ symbol: 'ES', signedQuantity: 1 }];
    const bracket = [
      order({ symbol: 'ES', signedQuantity: 2, ocoGroupId: 'oco-1' }),
      order({ symbol: 'ES', signedQuantity: 1, ocoGroupId: 'oco-1' }),
    ];
    // 10 filled + 20 for the larger leg only (not 30).
    expect(computeExposure(positions, bracket, products).totalWorstCase).toBe(30);
  });

  it('ignores reduce-intent orders, which may never fill', () => {
    const positions = [{ symbol: 'ES', signedQuantity: 3 }];
    const exits = [
      order({ symbol: 'ES', signedQuantity: -3, intent: 'REDUCE' }),
      order({ symbol: 'ES', signedQuantity: -3, intent: 'REDUCE', ocoGroupId: 'bracket' }),
    ];
    // Exposure stays at the filled 30; a working exit does not pre-credit a flat.
    expect(computeExposure(positions, exits, products).totalWorstCase).toBe(30);
  });

  it('does NOT net unrelated products against each other', () => {
    // Long 4 ES and short 4 NQ is 80 micro-equivalents of risk, not zero.
    const result = computeExposure(
      [{ symbol: 'ES', signedQuantity: 4 }, { symbol: 'NQ', signedQuantity: -4 }],
      [],
      products,
    );
    expect(result.totalWorstCase).toBe(80);
    expect(result.byGroup).toHaveLength(2);
    expect(
      evaluateNewOrder(
        [{ symbol: 'ES', signedQuantity: 4 }],
        [],
        order({ symbol: 'NQ', signedQuantity: -4 }),
        products,
        cap,
      ).allowed,
    ).toBe(false);
  });

  it('does net within a group, where the mini and micro track the same contract', () => {
    const result = computeExposure(
      [{ symbol: 'ES', signedQuantity: 2 }, { symbol: 'MES', signedQuantity: -5 }],
      [],
      products,
    );
    expect(result.totalWorstCase).toBe(15);
  });

  it('accounts for a pending order that would flip the position', () => {
    // Long 1 ES (10) with a working sell-to-open of 3 ES: worst case is short 20.
    const result = computeExposure(
      [{ symbol: 'ES', signedQuantity: 1 }],
      [order({ symbol: 'ES', signedQuantity: -3 })],
      products,
    );
    expect(result.totalWorstCase).toBe(20);
  });

  it('refuses instruments whose risk controls are not approved', () => {
    const decision = evaluateNewOrder([], [], order({ symbol: 'CL', signedQuantity: 1 }), products, cap);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/awaiting approved risk controls/);
  });

  it('refuses an entirely unknown instrument rather than assuming equal risk', () => {
    expect(() => computeExposure([{ symbol: 'GC', signedQuantity: 1 }], [], products)).toThrow(
      UnknownProductError,
    );
    const decision = evaluateNewOrder([], [], order({ symbol: 'GC', signedQuantity: 1 }), products, cap);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/No risk configuration/);
  });

  it('allows an order that exactly reaches the cap', () => {
    const decision = evaluateNewOrder([], [], order({ symbol: 'ES', signedQuantity: 4 }), products, cap);
    expect(decision.allowed).toBe(true);
    expect(decision.projectedMicroEquivalents).toBe(40);
  });
});

describe('plan risk parameters carry their approval status', () => {
  it('marks every risk parameter as unapproved for production', () => {
    expect(plan.drawdownAllowance.status).toBe('PROPOSED');
    expect(plan.dailyLossLimit.status).toBe('PROPOSED');
    expect(plan.retainedBuffer.status).toBe('PROPOSED');
    expect(TRAILING_STOP_OFFSET.status).toBe('PROPOSED');
  });

  it('keeps the confirmed position ceilings confirmed', () => {
    expect(getPlan('SIM_25K').positionCeiling.status).toBe('CONFIRMED');
    expect(getPlan('SIM_150K').positionCeiling.status).toBe('CONFIRMED');
    // The one the owner explicitly did not finalise stays unresolved.
    expect(getPlan('SIM_300K').positionCeiling.status).toBe('UNRESOLVED');
  });
});
