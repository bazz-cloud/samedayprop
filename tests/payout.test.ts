import { describe, expect, it } from 'vitest';
import { Money, usd } from '@/domain/money/money';
import {
  getPlan,
  GROSS_WITHDRAWAL_INCREMENT,
  MINIMUM_GROSS_WITHDRAWAL,
  MIN_POST_WITHDRAWAL_ROOM,
  TRAILING_STOP_OFFSET,
} from '@/domain/catalog/plans';
import {
  cashForGross,
  companyNonRevenueShare,
  computeCapacity,
  validateRequest,
  type PayoutContext,
  type RequestPreconditions,
} from '@/domain/payout/eligibility';
import {
  computeRemainingCapacity,
  consumeReservation,
  releaseReservation,
  reserveCapacity,
  type CapacityReservation,
} from '@/domain/payout/reservation';
import {
  assertTransition,
  breachShouldCancelPayout,
  canTransition,
  holdsCapacity,
  mayReverseSimulatedDeduction,
  PayoutTransitionError,
  traderMayCancel,
} from '@/domain/payout/state-machine';
import { applyEquityObservation, initialTrailingState } from '@/domain/risk/trailing';

const plan = getPlan('SIM_50K');

/** Context for the $50K plan under the proposed rules, at a given balance. */
function contextAt(
  balance: string,
  overrides: Partial<PayoutContext> = {},
): PayoutContext {
  // Derive a realistic trailing threshold: the account peaked at this balance.
  let trailing = initialTrailingState({
    startingBalance: plan.startingBalance,
    drawdownAllowance: plan.drawdownAllowance.value,
    stopOffset: TRAILING_STOP_OFFSET.value,
  });
  trailing = applyEquityObservation(
    {
      startingBalance: plan.startingBalance,
      drawdownAllowance: plan.drawdownAllowance.value,
      stopOffset: TRAILING_STOP_OFFSET.value,
    },
    trailing,
    usd(balance),
  );

  return {
    reconciledBalance: usd(balance),
    startingBalance: plan.startingBalance,
    retainedBuffer: plan.retainedBuffer.value,
    remainingDailyCash: plan.dailyCashPayoutCap.value,
    remainingLifetimeCash: null,
    trailingThreshold: trailing.threshold,
    minPostWithdrawalRoom: MIN_POST_WITHDRAWAL_ROOM.value,
    minimumGross: MINIMUM_GROSS_WITHDRAWAL.value,
    grossIncrement: GROSS_WITHDRAWAL_INCREMENT.value,
    ...overrides,
  };
}

const flatAndHealthy: RequestPreconditions = {
  isFlat: true,
  hasConflictingOrders: false,
  accountIsActive: true,
  dataIsStale: false,
};

describe('the worked $50K examples from the specification', () => {
  it('$52,499: the minimum withdrawal is unavailable', () => {
    const capacity = computeCapacity(contextAt('52499.00'));
    expect(capacity.eligible).toBe(false);
    expect(capacity.maxGross.toDecimalString()).toBe('499.00');
    expect(capacity.binding).toBe('BUFFER');
    expect(capacity.explanation).toContain('$52,500.00');
  });

  it('$52,500: a $500 gross request pays $250 cash and leaves $52,000', () => {
    const context = contextAt('52500.00');
    const capacity = computeCapacity(context);
    expect(capacity.eligible).toBe(true);
    expect(capacity.maxGross.toDecimalString()).toBe('500.00');

    const result = validateRequest(context, capacity, usd('500.00'), flatAndHealthy);
    expect(result.ok).toBe(true);
    expect(result.cash.toDecimalString()).toBe('250.00');
    expect(result.balanceAfter.toDecimalString()).toBe('52000.00');
  });

  it('$55,000: a $3,000 gross request pays $1,500 cash and leaves $52,000', () => {
    const context = contextAt('55000.00');
    const capacity = computeCapacity(context);
    // Buffer allows 3,000; the daily cash cap of 1,500 allows 3,000 gross too.
    expect(capacity.maxGross.toDecimalString()).toBe('3000.00');

    const result = validateRequest(context, capacity, usd('3000.00'), flatAndHealthy);
    expect(result.ok).toBe(true);
    expect(result.cash.toDecimalString()).toBe('1500.00');
    expect(result.balanceAfter.toDecimalString()).toBe('52000.00');
  });

  it('threshold $50,100 with $52,000 remaining leaves $1,900 of loss allowance', () => {
    const context = contextAt('52000.00', {
      trailingThreshold: usd('50100.00'),
    });
    expect(context.reconciledBalance.minus(context.trailingThreshold).toDecimalString()).toBe(
      '1900.00',
    );
  });

  it('applies NO consistency, best-day or minimum-trading-day test', () => {
    // A first-day account that went straight to 52,500 is immediately eligible.
    const context = contextAt('52500.00');
    const capacity = computeCapacity(context);
    expect(capacity.eligible).toBe(true);
    // The capacity calculation has no inputs for trading days or winning days.
    expect(Object.keys(context)).not.toContain('tradingDays');
    expect(Object.keys(context)).not.toContain('winningDays');
    expect(capacity.components.map((c) => c.constraint)).toEqual([
      'BUFFER',
      'DAILY_CASH_CAP',
      'TRAILING_ROOM',
    ]);
  });
});

describe('the 50/50 split', () => {
  it('pays exactly half in real cash', () => {
    expect(cashForGross(usd('500.00')).toDecimalString()).toBe('250.00');
    expect(cashForGross(usd('3000.00')).toDecimalString()).toBe('1500.00');
  });

  it('treats the other half as non-revenue, not company income', () => {
    expect(companyNonRevenueShare(usd('500.00')).toDecimalString()).toBe('250.00');
  });

  it('never produces a fractional cent, because gross is whole dollars', () => {
    expect(GROSS_WITHDRAWAL_INCREMENT.value.toDecimalString()).toBe('1.00');
    const context = contextAt('55000.00');
    const capacity = computeCapacity(context);
    expect(capacity.maxGross.isMultipleOf(usd('1.00'))).toBe(true);
    // An odd-cent request is refused rather than silently rounded.
    const odd = validateRequest(context, capacity, usd('500.01'), flatAndHealthy);
    expect(odd.ok).toBe(false);
    expect(odd.reason).toBe('NOT_AN_INCREMENT');
  });
});

describe('capacity bounds', () => {
  it('is bound by the daily cash cap when profit is plentiful', () => {
    const capacity = computeCapacity(contextAt('60000.00'));
    // Buffer allows 8,000 gross; the $1,500 daily cash cap allows only 3,000.
    expect(capacity.maxGross.toDecimalString()).toBe('3000.00');
    expect(capacity.maxCash.toDecimalString()).toBe('1500.00');
  });

  it('is bound by remaining daily capacity after an earlier payout', () => {
    const capacity = computeCapacity(
      contextAt('60000.00', { remainingDailyCash: usd('400.00') }),
    );
    expect(capacity.maxGross.toDecimalString()).toBe('800.00');
  });

  it('reports the daily cap as the binding constraint when it is exhausted', () => {
    const capacity = computeCapacity(
      contextAt('60000.00', { remainingDailyCash: usd('0.00') }),
    );
    expect(capacity.eligible).toBe(false);
    expect(capacity.binding).toBe('DAILY_CASH_CAP');
    expect(capacity.explanation).toMatch(/next trading session/);
  });

  it('applies a lifetime bound only when a cap has been approved', () => {
    const uncapped = computeCapacity(contextAt('60000.00'));
    expect(uncapped.components.map((c) => c.constraint)).not.toContain('LIFETIME_CASH_CAP');

    const capped = computeCapacity(
      contextAt('60000.00', { remainingLifetimeCash: usd('200.00') }),
    );
    expect(capped.maxGross.toDecimalString()).toBe('400.00');
    expect(capped.components.map((c) => c.constraint)).toContain('LIFETIME_CASH_CAP');
  });

  it('reports the lifetime cap when it is exhausted', () => {
    const capacity = computeCapacity(
      contextAt('60000.00', { remainingLifetimeCash: usd('0.00') }),
    );
    expect(capacity.binding).toBe('LIFETIME_CASH_CAP');
  });

  it('never lets a payout push equity onto the trailing threshold', () => {
    // Balance 52,600 but the threshold sits at 52,400: only 199.99 of room.
    const capacity = computeCapacity(
      contextAt('52600.00', { trailingThreshold: usd('52400.00') }),
    );
    expect(capacity.maxGross.toDecimalString()).toBe('199.00');
    expect(capacity.eligible).toBe(false);
    expect(capacity.binding).toBe('TRAILING_ROOM');
  });

  it('floors to the whole-dollar increment rather than rounding up', () => {
    const capacity = computeCapacity(contextAt('52999.99'));
    expect(capacity.maxGross.toDecimalString()).toBe('999.00');
  });

  it('reports zero, not a negative, when the account is below its buffer', () => {
    const capacity = computeCapacity(contextAt('49000.00'));
    expect(capacity.maxGross.toDecimalString()).toBe('0.00');
    expect(capacity.maxCash.toDecimalString()).toBe('0.00');
    expect(capacity.eligible).toBe(false);
  });

  it('counts commissions once: they are already inside the reconciled balance', () => {
    // 52,500 reconciled is the post-commission figure; nothing is subtracted again.
    const capacity = computeCapacity(contextAt('52500.00'));
    expect(capacity.maxGross.toDecimalString()).toBe('500.00');
  });
});

describe('request validation', () => {
  const context = contextAt('55000.00');
  const capacity = computeCapacity(context);

  it('rejects a request below the $500 minimum', () => {
    const result = validateRequest(context, capacity, usd('499.00'), flatAndHealthy);
    expect(result).toMatchObject({ ok: false, reason: 'BELOW_MINIMUM' });
  });

  it('rejects a request above capacity', () => {
    const result = validateRequest(context, capacity, usd('4000.00'), flatAndHealthy);
    expect(result).toMatchObject({ ok: false, reason: 'ABOVE_CAPACITY' });
  });

  it('requires flat positions', () => {
    const result = validateRequest(context, capacity, usd('500.00'), {
      ...flatAndHealthy,
      isFlat: false,
    });
    expect(result).toMatchObject({ ok: false, reason: 'NOT_FLAT' });
  });

  it('requires no conflicting working orders', () => {
    const result = validateRequest(context, capacity, usd('500.00'), {
      ...flatAndHealthy,
      hasConflictingOrders: true,
    });
    expect(result).toMatchObject({ ok: false, reason: 'CONFLICTING_ORDERS' });
  });

  it('blocks payouts entirely while authoritative data is stale', () => {
    const result = validateRequest(context, capacity, usd('500.00'), {
      ...flatAndHealthy,
      dataIsStale: true,
    });
    expect(result).toMatchObject({ ok: false, reason: 'DATA_STALE' });
  });

  it('blocks payouts on an inactive account', () => {
    const result = validateRequest(context, capacity, usd('500.00'), {
      ...flatAndHealthy,
      accountIsActive: false,
    });
    expect(result).toMatchObject({ ok: false, reason: 'ACCOUNT_NOT_ACTIVE' });
  });
});

describe('capacity reservations', () => {
  const window = { dailyCashCap: usd('1500.00'), lifetimeCashCap: usd('3000.00') };

  const reservation = (
    id: string,
    cash: string,
    sessionDate: string,
    status: CapacityReservation['status'] = 'ACTIVE',
  ): CapacityReservation => ({
    id,
    payoutRequestId: `req-${id}`,
    sessionDate,
    cashAmount: usd(cash),
    status,
  });

  it('counts pending reservations against the daily cap immediately', () => {
    const remaining = computeRemainingCapacity(
      window,
      [reservation('a', '600.00', '2026-01-15')],
      '2026-01-15',
    );
    expect(remaining.remainingDailyCash.toDecimalString()).toBe('900.00');
  });

  it('prevents two concurrent requests from both spending the same capacity', () => {
    const first = reserveCapacity(window, [], {
      id: 'r1',
      payoutRequestId: 'p1',
      sessionDate: '2026-01-15',
      cashAmount: usd('1000.00'),
    });
    expect(first.ok).toBe(true);

    // The second caller re-reads state including the first reservation.
    const second = reserveCapacity(window, [first.ok ? first.reservation : reservation('x', '0.00', '2026-01-15')], {
      id: 'r2',
      payoutRequestId: 'p2',
      sessionDate: '2026-01-15',
      cashAmount: usd('1000.00'),
    });
    expect(second).toMatchObject({ ok: false, reason: 'DAILY_CAP_EXCEEDED' });
  });

  it('lets multiple requests share the cap up to the limit', () => {
    const held = [reservation('a', '900.00', '2026-01-15')];
    const ok = reserveCapacity(window, held, {
      id: 'r2',
      payoutRequestId: 'p2',
      sessionDate: '2026-01-15',
      cashAmount: usd('600.00'),
    });
    expect(ok.ok).toBe(true);

    const overshoot = reserveCapacity(window, held, {
      id: 'r3',
      payoutRequestId: 'p3',
      sessionDate: '2026-01-15',
      cashAmount: usd('601.00'),
    });
    expect(overshoot.ok).toBe(false);
  });

  it('keeps a reservation attributed to the session it was requested in', () => {
    // Requested Thursday, still pending on Friday: Thursday's cap stays spent,
    // and Friday's cap is untouched.
    const held = [reservation('a', '1500.00', '2026-01-15')];
    expect(
      computeRemainingCapacity(window, held, '2026-01-15').remainingDailyCash.toDecimalString(),
    ).toBe('0.00');
    expect(
      computeRemainingCapacity(window, held, '2026-01-16').remainingDailyCash.toDecimalString(),
    ).toBe('1500.00');
    // But the lifetime cap is still charged, so day-hopping gains nothing there.
    expect(
      computeRemainingCapacity(window, held, '2026-01-16').remainingLifetimeCash?.toDecimalString(),
    ).toBe('1500.00');
  });

  it('enforces the lifetime cap across sessions', () => {
    const held = [
      reservation('a', '1500.00', '2026-01-15', 'CONSUMED'),
      reservation('b', '1400.00', '2026-01-16', 'CONSUMED'),
    ];
    const result = reserveCapacity(window, held, {
      id: 'r3',
      payoutRequestId: 'p3',
      sessionDate: '2026-01-19',
      cashAmount: usd('200.00'),
    });
    expect(result).toMatchObject({ ok: false, reason: 'LIFETIME_CAP_EXCEEDED' });
  });

  it('frees capacity when a reservation is released, but not when it was paid', () => {
    const active = reservation('a', '900.00', '2026-01-15');
    const released = releaseReservation(active);
    expect(
      computeRemainingCapacity(window, [released], '2026-01-15').remainingDailyCash.toDecimalString(),
    ).toBe('1500.00');

    const consumed = consumeReservation(active);
    expect(
      computeRemainingCapacity(window, [consumed], '2026-01-15').remainingDailyCash.toDecimalString(),
    ).toBe('600.00');
    expect(() => releaseReservation(consumed)).toThrow(/already been paid/);
  });

  it('treats an uncapped lifetime policy as unlimited only when explicitly configured', () => {
    const remaining = computeRemainingCapacity(
      { dailyCashCap: usd('1500.00'), lifetimeCashCap: null },
      [reservation('a', '9000.00', '2026-01-15', 'CONSUMED')],
      '2026-01-16',
    );
    expect(remaining.remainingLifetimeCash).toBeNull();
  });
});

describe('payout state machine', () => {
  it('follows the happy path', () => {
    const path = ['requested', 'reserved', 'validating', 'approved', 'submitted', 'paid'] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(() => assertTransition(path[i]!, path[i + 1]!)).not.toThrow();
    }
  });

  it('refuses to cancel a submitted payout, because cash may already be moving', () => {
    expect(canTransition('submitted', 'canceled')).toBe(false);
    expect(() => assertTransition('submitted', 'canceled')).toThrow(PayoutTransitionError);
  });

  it('routes an unknown provider outcome to reconciliation, not to failure', () => {
    expect(canTransition('submitted', 'needs_reconciliation')).toBe(true);
    expect(mayReverseSimulatedDeduction('needs_reconciliation', false)).toBe(false);
    // Even asserting the outcome is "confirmed" does not unlock a reversal here.
    expect(mayReverseSimulatedDeduction('needs_reconciliation', true)).toBe(false);
  });

  it('reverses a simulated deduction only on a CONFIRMED non-payment', () => {
    expect(mayReverseSimulatedDeduction('failed', true)).toBe(true);
    expect(mayReverseSimulatedDeduction('failed', false)).toBe(false);
    expect(mayReverseSimulatedDeduction('paid', true)).toBe(false);
    expect(mayReverseSimulatedDeduction('canceled', false)).toBe(true);
  });

  it('holds capacity in every non-releasing state', () => {
    expect(holdsCapacity('reserved')).toBe(true);
    expect(holdsCapacity('submitted')).toBe(true);
    expect(holdsCapacity('needs_reconciliation')).toBe(true);
    expect(holdsCapacity('paid')).toBe(true);
    expect(holdsCapacity('canceled')).toBe(false);
    expect(holdsCapacity('rejected')).toBe(false);
  });

  it('lets the trader cancel only before validation completes', () => {
    expect(traderMayCancel('requested')).toBe(true);
    expect(traderMayCancel('reserved')).toBe(true);
    expect(traderMayCancel('approved')).toBe(false);
    expect(traderMayCancel('submitted')).toBe(false);
  });

  it('treats paid as terminal', () => {
    expect(canTransition('paid', 'failed')).toBe(false);
    expect(canTransition('paid', 'canceled')).toBe(false);
  });

  it('does not let an unrelated breach silently void an earned payout', () => {
    expect(breachShouldCancelPayout()).toBe(false);
  });
});
