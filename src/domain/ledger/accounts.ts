/**
 * Chart of accounts across four SEPARATE, append-only ledgers.
 *
 * Keeping them distinct is the whole point. The single most important
 * accounting fact about this business is:
 *
 *   Simulated trading results are not cash and are not revenue.
 *
 *   - A simulated gain creates no cash revenue.
 *   - A simulated loss creates no cash revenue and is NOT a company trading
 *     loss. The company never had that money.
 *   - A $500 gross withdrawal reduces the simulated account by $500 and pays
 *     the trader $250 in real cash out of company funds. The other $250 is not
 *     received by anyone — it is simulated balance that ceases to exist.
 *
 * Mixing these into one ledger would make company revenue look like it moves
 * with trader P&L, which is false and would misstate the business. So the
 * SIMULATION ledger is denominated in simulated units and can never post to a
 * cash or revenue account; `assertLedgerIsolation` enforces that mechanically.
 */

export type LedgerName =
  /** Simulated account balances. Units are simulated dollars, NOT money. */
  | 'SIMULATION'
  /** Real company cash movements. */
  | 'CASH'
  /** Payout obligations and reserved capacity. */
  | 'OBLIGATION'
  /** Service revenue and the costs of earning it. */
  | 'REVENUE';

export type AccountCode =
  // ---- SIMULATION -------------------------------------------------------
  /** A trader's simulated equity. */
  | 'SIM_ACCOUNT_EQUITY'
  /** Contra account representing the simulation program itself. */
  | 'SIM_PROGRAM_COUNTERPARTY'

  // ---- CASH -------------------------------------------------------------
  /** Cash held by the payment processor and not yet paid out to us. */
  | 'CASH_PROCESSOR_HELD'
  /** Cash actually available in the company bank account. */
  | 'CASH_AVAILABLE'
  /** Cash reserved against outstanding payout obligations. */
  | 'CASH_RESERVES'
  /** Real cash paid to traders as rewards. */
  | 'CASH_TRADER_REWARDS_PAID'
  | 'CASH_REFUNDS_PAID'
  | 'CASH_CHARGEBACKS'
  | 'CASH_PROCESSOR_FEES_PAID'
  | 'CASH_VENDOR_COSTS_PAID'
  | 'CASH_ACQUISITION_COSTS_PAID'

  // ---- OBLIGATION -------------------------------------------------------
  /** Cash rewards approved but not yet paid. */
  | 'OBLIGATION_REWARDS_PAYABLE'
  /** Capacity reserved for in-flight payout requests. */
  | 'OBLIGATION_CAPACITY_RESERVED'
  | 'OBLIGATION_EQUITY'

  // ---- REVENUE ----------------------------------------------------------
  /** Fees collected for account purchases. */
  | 'REVENUE_ACCOUNT_FEES'
  /** Fees collected for optional add-ons. */
  | 'REVENUE_ADDON_FEES'
  /** Contra-revenue for coupon discounts. */
  | 'CONTRA_REVENUE_DISCOUNTS'
  | 'CONTRA_REVENUE_REFUNDS'
  | 'COST_PROCESSOR_FEES'
  | 'COST_ADDON_DELIVERY'
  | 'COST_PROVIDER_FEES'
  | 'REVENUE_RECEIVABLE';

export interface AccountSpec {
  readonly code: AccountCode;
  readonly ledger: LedgerName;
  /** Which side increases the account. */
  readonly normalBalance: 'DEBIT' | 'CREDIT';
  readonly description: string;
}

export const CHART_OF_ACCOUNTS: readonly AccountSpec[] = [
  {
    code: 'SIM_ACCOUNT_EQUITY',
    ledger: 'SIMULATION',
    normalBalance: 'DEBIT',
    description: "A trader's simulated account equity. Simulated units, not money.",
  },
  {
    code: 'SIM_PROGRAM_COUNTERPARTY',
    ledger: 'SIMULATION',
    normalBalance: 'CREDIT',
    description: 'Counterparty for simulated balance movements. Never settles in cash.',
  },

  {
    code: 'CASH_PROCESSOR_HELD',
    ledger: 'CASH',
    normalBalance: 'DEBIT',
    description: 'Real cash held by the payment processor, not yet settled to the bank.',
  },
  {
    code: 'CASH_AVAILABLE',
    ledger: 'CASH',
    normalBalance: 'DEBIT',
    description: 'Real cash available in the company bank account.',
  },
  {
    code: 'CASH_RESERVES',
    ledger: 'CASH',
    normalBalance: 'DEBIT',
    description: 'Real cash set aside against outstanding trader reward obligations.',
  },
  {
    code: 'CASH_TRADER_REWARDS_PAID',
    ledger: 'CASH',
    normalBalance: 'DEBIT',
    description: 'Real cash paid to traders as rewards. A genuine company expense.',
  },
  {
    code: 'CASH_REFUNDS_PAID',
    ledger: 'CASH',
    normalBalance: 'DEBIT',
    description: 'Real cash refunded to customers.',
  },
  {
    code: 'CASH_CHARGEBACKS',
    ledger: 'CASH',
    normalBalance: 'DEBIT',
    description: 'Real cash lost to chargebacks, including any chargeback fee.',
  },
  {
    code: 'CASH_PROCESSOR_FEES_PAID',
    ledger: 'CASH',
    normalBalance: 'DEBIT',
    description: 'Real cash paid to the payment processor.',
  },
  {
    code: 'CASH_VENDOR_COSTS_PAID',
    ledger: 'CASH',
    normalBalance: 'DEBIT',
    description: 'Real cash paid to vendors, including the trading platform provider.',
  },
  {
    code: 'CASH_ACQUISITION_COSTS_PAID',
    ledger: 'CASH',
    normalBalance: 'DEBIT',
    description: 'Real cash spent acquiring customers.',
  },

  {
    code: 'OBLIGATION_REWARDS_PAYABLE',
    ledger: 'OBLIGATION',
    normalBalance: 'CREDIT',
    description: 'Cash rewards owed to traders but not yet paid.',
  },
  {
    code: 'OBLIGATION_CAPACITY_RESERVED',
    ledger: 'OBLIGATION',
    normalBalance: 'CREDIT',
    description: 'Payout capacity reserved for in-flight requests.',
  },
  {
    code: 'OBLIGATION_EQUITY',
    ledger: 'OBLIGATION',
    normalBalance: 'DEBIT',
    description: 'Balancing account for the obligation ledger.',
  },

  {
    code: 'REVENUE_ACCOUNT_FEES',
    ledger: 'REVENUE',
    normalBalance: 'CREDIT',
    description: 'Fees earned from account purchases. Real revenue.',
  },
  {
    code: 'REVENUE_ADDON_FEES',
    ledger: 'REVENUE',
    normalBalance: 'CREDIT',
    description: 'Fees earned from optional add-ons. Real revenue.',
  },
  {
    code: 'CONTRA_REVENUE_DISCOUNTS',
    ledger: 'REVENUE',
    normalBalance: 'DEBIT',
    description: 'Coupon discounts given, reducing gross revenue.',
  },
  {
    code: 'CONTRA_REVENUE_REFUNDS',
    ledger: 'REVENUE',
    normalBalance: 'DEBIT',
    description: 'Refunds issued, reducing recognised revenue.',
  },
  {
    code: 'COST_PROCESSOR_FEES',
    ledger: 'REVENUE',
    normalBalance: 'DEBIT',
    description: 'Payment processing cost attributable to a sale.',
  },
  {
    code: 'COST_ADDON_DELIVERY',
    ledger: 'REVENUE',
    normalBalance: 'DEBIT',
    description: 'Cost of delivering a purchased add-on.',
  },
  {
    code: 'COST_PROVIDER_FEES',
    ledger: 'REVENUE',
    normalBalance: 'DEBIT',
    description: 'Trading platform and market data cost attributable to an account.',
  },
  {
    code: 'REVENUE_RECEIVABLE',
    ledger: 'REVENUE',
    normalBalance: 'DEBIT',
    description: 'Balancing account for revenue recognised but held by the processor.',
  },
];

const ACCOUNT_INDEX = new Map<AccountCode, AccountSpec>(
  CHART_OF_ACCOUNTS.map((a) => [a.code, a]),
);

export function accountSpec(code: AccountCode): AccountSpec {
  const spec = ACCOUNT_INDEX.get(code);
  if (!spec) throw new Error(`Unknown account code ${code}`);
  return spec;
}

export function ledgerOf(code: AccountCode): LedgerName {
  return accountSpec(code).ledger;
}

/**
 * Accounts that represent real company cash leaving or arriving.
 *
 * Used by reporting to answer "what did this actually cost us" without ever
 * picking up a simulated figure.
 */
export const REAL_CASH_ACCOUNTS: readonly AccountCode[] = CHART_OF_ACCOUNTS.filter(
  (a) => a.ledger === 'CASH',
).map((a) => a.code);

export const SIMULATED_ACCOUNTS: readonly AccountCode[] = CHART_OF_ACCOUNTS.filter(
  (a) => a.ledger === 'SIMULATION',
).map((a) => a.code);
