import { describe, expect, it } from 'vitest';
import { Money, usd } from '@/domain/money/money';
import { CHART_OF_ACCOUNTS, ledgerOf } from '@/domain/ledger/accounts';
import {
  buildCompensatingEntry,
  buildObligationEntry,
  buildPayoutEntries,
  buildPurchaseEntries,
  buildSimulatedAdjustmentEntry,
  credit,
  debit,
  LedgerError,
  validateEntry,
  type LedgerEntryDraft,
} from '@/domain/ledger/entries';

describe('ledger integrity', () => {
  it('requires every entry to balance', () => {
    const unbalanced: LedgerEntryDraft = {
      ledger: 'CASH',
      lines: [debit('CASH_AVAILABLE', usd('100.00')), credit('CASH_RESERVES', usd('90.00'))],
      reason: 'test',
      actor: 'test',
      idempotencyKey: 'k',
      policyVersion: 'v1',
      references: {},
    };
    expect(() => validateEntry(unbalanced)).toThrow(/Unbalanced/);
  });

  it('refuses to mix ledgers inside one entry', () => {
    const mixed: LedgerEntryDraft = {
      ledger: 'CASH',
      lines: [debit('CASH_AVAILABLE', usd('100.00')), credit('SIM_ACCOUNT_EQUITY', usd('100.00'))],
      reason: 'test',
      actor: 'test',
      idempotencyKey: 'k',
      policyVersion: 'v1',
      references: {},
    };
    expect(() => validateEntry(mixed)).toThrow(/belongs to the SIMULATION ledger/);
  });

  it('refuses to post a simulated movement to a cash or revenue account', () => {
    const leak: LedgerEntryDraft = {
      ledger: 'SIMULATION',
      lines: [debit('REVENUE_ACCOUNT_FEES', usd('250.00')), credit('SIM_ACCOUNT_EQUITY', usd('250.00'))],
      reason: 'test',
      actor: 'test',
      idempotencyKey: 'k',
      policyVersion: 'v1',
      references: {},
    };
    expect(() => validateEntry(leak)).toThrow(LedgerError);
  });

  it('rejects negative amounts', () => {
    expect(() => debit('CASH_AVAILABLE', usd('-1.00'))).toThrow(/non-negative/);
  });

  it('assigns every account in the chart to exactly one ledger', () => {
    const codes = CHART_OF_ACCOUNTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const account of CHART_OF_ACCOUNTS) {
      expect(ledgerOf(account.code)).toBe(account.ledger);
    }
  });
});

describe('a paid reward, the central accounting case', () => {
  const entries = buildPayoutEntries({
    payoutRequestId: 'po_1',
    tradingAccountId: 'ta_1',
    userId: 'u_1',
    gross: usd('500.00'),
    cash: usd('250.00'),
    policyVersion: 'ruleset-v1',
    idempotencyKey: 'payout:po_1',
  });

  it('produces balanced entries in three separate ledgers', () => {
    entries.forEach(validateEntry);
    expect(entries.map((e) => e.ledger)).toEqual(['SIMULATION', 'CASH', 'OBLIGATION']);
  });

  it('deducts $500 from the simulated account', () => {
    const sim = entries.find((e) => e.ledger === 'SIMULATION')!;
    const simEquity = sim.lines.find((l) => l.account === 'SIM_ACCOUNT_EQUITY')!;
    expect(simEquity.credit.toDecimalString()).toBe('500.00');
  });

  it('pays exactly $250 of REAL cash', () => {
    const cash = entries.find((e) => e.ledger === 'CASH')!;
    const paid = cash.lines.find((l) => l.account === 'CASH_TRADER_REWARDS_PAID')!;
    expect(paid.debit.toDecimalString()).toBe('250.00');
  });

  it('records NO revenue anywhere for the other $250', () => {
    const revenueLines = entries.flatMap((e) =>
      e.lines.filter((l) => ledgerOf(l.account) === 'REVENUE'),
    );
    expect(revenueLines).toHaveLength(0);
  });

  it('refuses a payout whose cash is not exactly half the gross', () => {
    expect(() =>
      buildPayoutEntries({
        payoutRequestId: 'po_2',
        tradingAccountId: 'ta_1',
        userId: 'u_1',
        gross: usd('500.00'),
        cash: usd('300.00'),
        policyVersion: 'ruleset-v1',
        idempotencyKey: 'payout:po_2',
      }),
    ).toThrow(/50\/50 split/);
  });

  it('carries an idempotency key on every entry so a retry cannot double-post', () => {
    const keys = entries.map((e) => e.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.startsWith('payout:po_1'))).toBe(true);
  });
});

describe('a purchase', () => {
  const entries = buildPurchaseEntries({
    orderId: 'ord_1',
    userId: 'u_1',
    accountFeeGross: usd('599.00'),
    addOnFeeGross: usd('0.00'),
    discount: usd('149.75'),
    processorFee: usd('13.32'),
    netCashReceived: usd('435.93'),
    policyVersion: 'catalog-v1',
    idempotencyKey: 'purchase:ord_1',
  });

  it('balances and records real revenue', () => {
    entries.forEach(validateEntry);
    const revenue = entries.find((e) => e.ledger === 'REVENUE')!;
    const accountFees = revenue.lines.find((l) => l.account === 'REVENUE_ACCOUNT_FEES')!;
    expect(accountFees.credit.toDecimalString()).toBe('599.00');
    const discounts = revenue.lines.find((l) => l.account === 'CONTRA_REVENUE_DISCOUNTS')!;
    expect(discounts.debit.toDecimalString()).toBe('149.75');
  });

  it('never touches the simulation ledger', () => {
    expect(entries.some((e) => e.ledger === 'SIMULATION')).toBe(false);
  });
});

describe('corrections are additive, never destructive', () => {
  it('reverses a compensating entry line by line', () => {
    const original = buildObligationEntry({
      payoutRequestId: 'po_1',
      cash: usd('250.00'),
      policyVersion: 'v1',
      idempotencyKey: 'ob:po_1',
    });
    const reversal = buildCompensatingEntry(original, 'entry_123', 'payout canceled', 'admin_1');

    validateEntry(original);
    validateEntry(reversal);
    expect(reversal.compensatesEntryId).toBe('entry_123');
    expect(reversal.lines[0]!.debit.equals(original.lines[0]!.credit)).toBe(true);
    expect(reversal.lines[0]!.credit.equals(original.lines[0]!.debit)).toBe(true);

    // Original and reversal together net to zero on every account.
    const net = new Map<string, Money>();
    for (const entry of [original, reversal]) {
      for (const line of entry.lines) {
        const current = net.get(line.account) ?? Money.zero();
        net.set(line.account, current.plus(line.debit).minus(line.credit));
      }
    }
    for (const amount of net.values()) {
      expect(amount.isZero()).toBe(true);
    }
  });
});

describe('manual simulated adjustments', () => {
  it('requires a stated reason', () => {
    expect(() =>
      buildSimulatedAdjustmentEntry({
        tradingAccountId: 'ta_1',
        amount: usd('100.00'),
        increase: true,
        reason: '   ',
        actor: 'admin_1',
        policyVersion: 'v1',
        idempotencyKey: 'adj_1',
      }),
    ).toThrow(/requires a stated reason/);
  });

  it('stays inside the simulation ledger', () => {
    const entry = buildSimulatedAdjustmentEntry({
      tradingAccountId: 'ta_1',
      amount: usd('100.00'),
      increase: false,
      reason: 'Correcting a duplicated fill reported by the provider',
      actor: 'admin_1',
      policyVersion: 'v1',
      idempotencyKey: 'adj_1',
    });
    validateEntry(entry);
    expect(entry.ledger).toBe('SIMULATION');
    expect(entry.actor).toBe('admin_1');
  });
});
