/**
 * Append-only, balanced ledger entries.
 *
 * Every entry is a set of debit/credit lines that must sum to zero within ONE
 * ledger. Nothing is ever edited or deleted: a correction is a new compensating
 * entry that references the original. That is what makes the financial history
 * reconstructible, which is the whole point of keeping ledgers at all.
 *
 * `buildPayoutEntries` below is the clearest expression of the business model —
 * a $500 gross withdrawal produces a $500 SIMULATION movement and a $250 CASH
 * movement, and nothing anywhere records $250 of revenue.
 */

import { Money } from '../money/money';
import { accountSpec, ledgerOf, type AccountCode, type LedgerName } from './accounts';

export interface LedgerLine {
  readonly account: AccountCode;
  /** Exactly one of debit/credit is non-zero. */
  readonly debit: Money;
  readonly credit: Money;
}

export interface LedgerEntryDraft {
  readonly ledger: LedgerName;
  readonly lines: readonly LedgerLine[];
  /** Why this entry exists, in words an auditor can read. */
  readonly reason: string;
  /** Who caused it: a user id, "system", or an operator id. */
  readonly actor: string;
  /** Stable key so a retried operation cannot post the entry twice. */
  readonly idempotencyKey: string;
  /** Version of the rule/policy in force, so old entries stay interpretable. */
  readonly policyVersion: string;
  readonly references: Readonly<Record<string, string>>;
  /** Set for corrections; points at the entry being compensated. */
  readonly compensatesEntryId?: string;
}

export class LedgerError extends Error {}

export function debit(account: AccountCode, amount: Money): LedgerLine {
  if (amount.isNegative()) throw new LedgerError('Ledger amounts must be non-negative');
  return { account, debit: amount, credit: Money.zero(amount.currency) };
}

export function credit(account: AccountCode, amount: Money): LedgerLine {
  if (amount.isNegative()) throw new LedgerError('Ledger amounts must be non-negative');
  return { account, debit: Money.zero(amount.currency), credit: amount };
}

/** Debits must equal credits, and every line must belong to the entry's ledger. */
export function assertBalanced(entry: LedgerEntryDraft): void {
  if (entry.lines.length === 0) {
    throw new LedgerError('A ledger entry must have at least one line');
  }

  const totalDebit = Money.sum(entry.lines.map((l) => l.debit));
  const totalCredit = Money.sum(entry.lines.map((l) => l.credit));

  if (!totalDebit.equals(totalCredit)) {
    throw new LedgerError(
      `Unbalanced entry: debits ${totalDebit.toDecimalString()} != credits ` +
        `${totalCredit.toDecimalString()} (${entry.reason})`,
    );
  }

  for (const line of entry.lines) {
    const spec = accountSpec(line.account);
    if (spec.ledger !== entry.ledger) {
      throw new LedgerError(
        `Account ${line.account} belongs to the ${spec.ledger} ledger but the entry is on ` +
          `${entry.ledger}. Ledgers are kept separate so simulated units can never be ` +
          'posted to a cash or revenue account.',
      );
    }
    if (line.debit.isPositive() && line.credit.isPositive()) {
      throw new LedgerError(`Line on ${line.account} has both a debit and a credit`);
    }
  }
}

/**
 * Guard against the category error this system exists to avoid: a simulated
 * amount being recorded as company revenue.
 */
export function assertNoSimulatedRevenue(entry: LedgerEntryDraft): void {
  if (entry.ledger !== 'SIMULATION') return;
  for (const line of entry.lines) {
    if (ledgerOf(line.account) !== 'SIMULATION') {
      throw new LedgerError(
        `Simulated movement attempted to post to ${line.account}. Simulated trading results ` +
          'are never cash and never revenue.',
      );
    }
  }
}

export function validateEntry(entry: LedgerEntryDraft): void {
  assertBalanced(entry);
  assertNoSimulatedRevenue(entry);
}

// ---------------------------------------------------------------------------
// Standard entry builders
// ---------------------------------------------------------------------------

export interface PurchaseEntryInput {
  readonly orderId: string;
  readonly userId: string;
  readonly accountFeeGross: Money;
  readonly addOnFeeGross: Money;
  readonly discount: Money;
  readonly processorFee: Money;
  readonly netCashReceived: Money;
  readonly policyVersion: string;
  readonly idempotencyKey: string;
}

/**
 * A completed purchase: real revenue, a real processor cost, and real cash.
 *
 * This is the ONLY way money actually enters the business.
 */
export function buildPurchaseEntries(input: PurchaseEntryInput): LedgerEntryDraft[] {
  const references = { orderId: input.orderId, userId: input.userId };

  const revenueEntry: LedgerEntryDraft = {
    ledger: 'REVENUE',
    reason: 'Account and add-on fees earned on a completed purchase',
    actor: 'system',
    idempotencyKey: `${input.idempotencyKey}:revenue`,
    policyVersion: input.policyVersion,
    references,
    lines: [
      debit('REVENUE_RECEIVABLE', input.accountFeeGross.plus(input.addOnFeeGross).minus(input.discount)),
      debit('CONTRA_REVENUE_DISCOUNTS', input.discount),
      credit('REVENUE_ACCOUNT_FEES', input.accountFeeGross),
      credit('REVENUE_ADDON_FEES', input.addOnFeeGross),
    ].filter((line) => line.debit.isPositive() || line.credit.isPositive()),
  };

  const cashEntry: LedgerEntryDraft = {
    ledger: 'CASH',
    reason: 'Cash received from the payment processor, net of processing fees',
    actor: 'system',
    idempotencyKey: `${input.idempotencyKey}:cash`,
    policyVersion: input.policyVersion,
    references,
    lines: [
      debit('CASH_PROCESSOR_HELD', input.netCashReceived),
      debit('CASH_PROCESSOR_FEES_PAID', input.processorFee),
      credit('CASH_AVAILABLE', input.netCashReceived.plus(input.processorFee)),
    ].filter((line) => line.debit.isPositive() || line.credit.isPositive()),
  };

  return [revenueEntry, cashEntry];
}

export interface PayoutEntryInput {
  readonly payoutRequestId: string;
  readonly tradingAccountId: string;
  readonly userId: string;
  /** Gross simulated deduction. */
  readonly gross: Money;
  /** Real cash paid: exactly half the gross. */
  readonly cash: Money;
  readonly policyVersion: string;
  readonly idempotencyKey: string;
}

/**
 * A paid reward, in three separate ledgers.
 *
 * Note what is absent: no revenue entry. The half of the gross that is not paid
 * to the trader is not received by the company. Recording it as revenue would
 * overstate income by exactly the amount of every payout ever made.
 */
export function buildPayoutEntries(input: PayoutEntryInput): LedgerEntryDraft[] {
  if (!input.cash.timesInt(2).equals(input.gross)) {
    throw new LedgerError(
      `Payout cash ${input.cash.toDecimalString()} is not half of gross ` +
        `${input.gross.toDecimalString()}; the 50/50 split is a confirmed term.`,
    );
  }

  const references = {
    payoutRequestId: input.payoutRequestId,
    tradingAccountId: input.tradingAccountId,
    userId: input.userId,
  };

  return [
    {
      ledger: 'SIMULATION',
      reason:
        'Gross withdrawal deducted from the simulated account. Simulated units only; ' +
        'this movement is not cash and is not revenue.',
      actor: 'system',
      idempotencyKey: `${input.idempotencyKey}:sim`,
      policyVersion: input.policyVersion,
      references,
      lines: [debit('SIM_PROGRAM_COUNTERPARTY', input.gross), credit('SIM_ACCOUNT_EQUITY', input.gross)],
    },
    {
      ledger: 'CASH',
      reason: 'Real cash reward paid to the trader, being 50% of the gross withdrawal',
      actor: 'system',
      idempotencyKey: `${input.idempotencyKey}:cash`,
      policyVersion: input.policyVersion,
      references,
      lines: [debit('CASH_TRADER_REWARDS_PAID', input.cash), credit('CASH_AVAILABLE', input.cash)],
    },
    {
      ledger: 'OBLIGATION',
      reason: 'Reward obligation discharged by payment',
      actor: 'system',
      idempotencyKey: `${input.idempotencyKey}:obligation`,
      policyVersion: input.policyVersion,
      references,
      lines: [debit('OBLIGATION_REWARDS_PAYABLE', input.cash), credit('OBLIGATION_EQUITY', input.cash)],
    },
  ];
}

/** Records an obligation at approval time, before cash actually moves. */
export function buildObligationEntry(input: {
  payoutRequestId: string;
  cash: Money;
  policyVersion: string;
  idempotencyKey: string;
}): LedgerEntryDraft {
  return {
    ledger: 'OBLIGATION',
    reason: 'Cash reward approved and now owed to the trader',
    actor: 'system',
    idempotencyKey: `${input.idempotencyKey}:accrue`,
    policyVersion: input.policyVersion,
    references: { payoutRequestId: input.payoutRequestId },
    lines: [debit('OBLIGATION_EQUITY', input.cash), credit('OBLIGATION_REWARDS_PAYABLE', input.cash)],
  };
}

/**
 * Reverse a previous entry with a compensating one.
 *
 * Deliberately additive: the original entry stays exactly as posted, and the
 * correction sits beside it. Destructive edits would make the ledger
 * unauditable.
 */
export function buildCompensatingEntry(
  original: LedgerEntryDraft,
  originalEntryId: string,
  reason: string,
  actor: string,
): LedgerEntryDraft {
  return {
    ...original,
    reason: `Compensating entry: ${reason}`,
    actor,
    idempotencyKey: `${original.idempotencyKey}:compensate`,
    compensatesEntryId: originalEntryId,
    lines: original.lines.map((line) => ({
      account: line.account,
      debit: line.credit,
      credit: line.debit,
    })),
  };
}

export interface SimulatedAdjustmentInput {
  readonly tradingAccountId: string;
  readonly amount: Money;
  readonly increase: boolean;
  readonly reason: string;
  readonly actor: string;
  readonly policyVersion: string;
  readonly idempotencyKey: string;
}

/** A manual simulated balance adjustment. Always requires a stated reason. */
export function buildSimulatedAdjustmentEntry(
  input: SimulatedAdjustmentInput,
): LedgerEntryDraft {
  if (!input.reason.trim()) {
    throw new LedgerError('A manual simulated balance adjustment requires a stated reason');
  }
  return {
    ledger: 'SIMULATION',
    reason: input.reason,
    actor: input.actor,
    idempotencyKey: input.idempotencyKey,
    policyVersion: input.policyVersion,
    references: { tradingAccountId: input.tradingAccountId },
    lines: input.increase
      ? [debit('SIM_ACCOUNT_EQUITY', input.amount), credit('SIM_PROGRAM_COUNTERPARTY', input.amount)]
      : [debit('SIM_PROGRAM_COUNTERPARTY', input.amount), credit('SIM_ACCOUNT_EQUITY', input.amount)],
  };
}
