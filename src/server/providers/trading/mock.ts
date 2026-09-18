/**
 * Mock trading provider for local development and demo mode.
 *
 * This adapter is a SIMULATION OF A SIMULATION. It produces realistic
 * behaviour — including failures, out-of-order events and unknown outcomes —
 * so the surrounding machinery can be exercised without partner credentials.
 *
 * Every capability is MOCK_ONLY, which means `requireCapability` refuses to run
 * it outside MOCK mode. Nothing this file returns is evidence that Tradovate
 * supports the corresponding operation.
 */

import { Money, usd } from '@/domain/money/money';
import type {
  AccountSnapshot,
  ActionResult,
  ProvisionAccountRequest,
  ProvisionAccountResult,
  RiskConfiguration,
  RiskVerification,
  TradingProvider,
  TradingProviderCapabilities,
} from './types';

const MOCK_CAPABILITIES: TradingProviderCapabilities = {
  createCustomerIdentity: 'MOCK_ONLY',
  linkExistingIdentity: 'MOCK_ONLY',
  provisionSimulatedAccount: 'MOCK_ONLY',
  secureCredentialDelivery: 'MOCK_ONLY',
  configureRisk: 'MOCK_ONLY',
  readBackRiskConfiguration: 'MOCK_ONLY',
  authoritativeEquityStream: 'MOCK_ONLY',
  authoritativeOrderAndFillStream: 'MOCK_ONLY',
  disableTrading: 'MOCK_ONLY',
  flattenPositions: 'MOCK_ONLY',
  adjustSimBalance: 'MOCK_ONLY',
  marketDataEntitlements: 'MOCK_ONLY',
  commissionSchedule: 'MOCK_ONLY',
  eventReplay: 'MOCK_ONLY',
};

interface MockAccountState {
  externalAccountId: string;
  equity: Money;
  balance: Money;
  unrealised: Money;
  commissions: Money;
  positions: { symbol: string; signedQuantity: number }[];
  workingOrders: AccountSnapshot['workingOrders'];
  sequence: bigint;
  tradingDisabled: boolean;
  riskConfiguration: RiskConfiguration | null;
}

export interface MockFailureScript {
  /** Fail the next N provisioning calls with a retryable error. */
  readonly failProvisioningTimes?: number;
  /** Make provisioning fail permanently. */
  readonly provisioningPermanentFailure?: boolean;
  /** Report risk configuration as applied but read back WRONG values. */
  readonly riskReadBackMismatch?: boolean;
  /** Accept a flatten request without ever confirming it. */
  readonly flattenNeverConfirms?: boolean;
  /** Make snapshots throw, to exercise staleness handling. */
  readonly snapshotUnavailable?: boolean;
}

export class MockTradingProvider implements TradingProvider {
  readonly name = 'mock-trading';
  readonly mode = 'MOCK' as const;
  readonly capabilities = MOCK_CAPABILITIES;

  private readonly accounts = new Map<string, MockAccountState>();
  /** Keyed by idempotency key, so a retry returns the SAME account. */
  private readonly provisionedByKey = new Map<string, ProvisionAccountResult>();
  private readonly appliedAdjustments = new Set<string>();
  private provisioningFailuresRemaining: number;

  constructor(private readonly script: MockFailureScript = {}) {
    this.provisioningFailuresRemaining = script.failProvisioningTimes ?? 0;
  }

  async provisionAccount(request: ProvisionAccountRequest): Promise<ProvisionAccountResult> {
    // Idempotency first: a duplicate webhook or a retried job must never create
    // a second identity or a second account for the same order.
    const existing = this.provisionedByKey.get(request.idempotencyKey);
    if (existing) return existing;

    if (this.script.provisioningPermanentFailure) {
      const error = new Error('Mock provider: identity rejected (permanent)');
      (error as Error & { retryable?: boolean }).retryable = false;
      throw error;
    }

    if (this.provisioningFailuresRemaining > 0) {
      this.provisioningFailuresRemaining -= 1;
      const error = new Error('Mock provider: transient upstream error');
      (error as Error & { retryable?: boolean }).retryable = true;
      throw error;
    }

    const externalAccountId = `MOCK-${request.planKey}-${request.orderId.slice(-8)}`;

    this.accounts.set(externalAccountId, {
      externalAccountId,
      equity: request.startingBalance,
      balance: request.startingBalance,
      unrealised: Money.zero(),
      commissions: Money.zero(),
      positions: [],
      workingOrders: [],
      sequence: 1n,
      tradingDisabled: false,
      riskConfiguration: null,
    });

    const result: ProvisionAccountResult = {
      externalAccountId,
      externalJobRef: `mockjob_${request.idempotencyKey.slice(0, 12)}`,
      accessDelivery: {
        kind: 'MOCK',
        detail:
          'Mock access only. No real platform account exists and no credentials were issued.',
      },
    };
    this.provisionedByKey.set(request.idempotencyKey, result);
    return result;
  }

  async configureRisk(
    externalAccountId: string,
    configuration: RiskConfiguration,
  ): Promise<RiskVerification> {
    const account = this.requireAccount(externalAccountId);
    account.riskConfiguration = configuration;

    if (this.script.riskReadBackMismatch) {
      // The dangerous case: the write "succeeded" but the read-back disagrees.
      // Reporting verified:false here is what stops the account going active.
      return {
        verified: false,
        appliedAt: new Date().toISOString(),
        evidence: JSON.stringify({ sent: serialiseRisk(configuration), readBack: null }),
        mismatches: ['maxMicroEquivalents could not be read back from the provider'],
      };
    }

    return {
      verified: true,
      appliedAt: new Date().toISOString(),
      evidence: JSON.stringify({
        sent: serialiseRisk(configuration),
        readBack: serialiseRisk(configuration),
        note: 'Mock read-back. Not evidence of real provider support.',
      }),
      mismatches: [],
    };
  }

  async fetchAccountSnapshot(externalAccountId: string): Promise<AccountSnapshot> {
    if (this.script.snapshotUnavailable) {
      throw new Error('Mock provider: account data unavailable');
    }
    const account = this.requireAccount(externalAccountId);
    return {
      externalAccountId,
      equity: account.equity,
      balance: account.balance,
      unrealised: account.unrealised,
      commissions: account.commissions,
      positions: [...account.positions],
      workingOrders: [...account.workingOrders],
      sequence: account.sequence,
      sourceTimestamp: new Date().toISOString(),
    };
  }

  async disableTrading(externalAccountId: string, reason: string): Promise<ActionResult> {
    const account = this.requireAccount(externalAccountId);
    account.tradingDisabled = true;
    return {
      requested: true,
      confirmed: true,
      detail: `Mock provider disabled trading: ${reason}`,
      providerRef: `mockdisable_${account.sequence}`,
    };
  }

  async flattenPositions(externalAccountId: string, reason: string): Promise<ActionResult> {
    const account = this.requireAccount(externalAccountId);

    if (this.script.flattenNeverConfirms) {
      // Requested but NOT confirmed. The caller must not treat this as flat.
      return {
        requested: true,
        confirmed: false,
        detail: 'Flatten request accepted but no confirmation received from the provider.',
        providerRef: null,
      };
    }

    account.positions = [];
    account.workingOrders = [];
    account.unrealised = Money.zero();
    account.sequence += 1n;
    return {
      requested: true,
      confirmed: true,
      detail: `Mock provider flattened positions: ${reason}`,
      providerRef: `mockflatten_${account.sequence}`,
    };
  }

  async adjustSimBalance(
    externalAccountId: string,
    delta: Money,
    reason: string,
    idempotencyKey: string,
  ): Promise<ActionResult> {
    const account = this.requireAccount(externalAccountId);

    if (this.appliedAdjustments.has(idempotencyKey)) {
      return {
        requested: true,
        confirmed: true,
        detail: 'Adjustment already applied; returning the original result.',
        providerRef: `mockadj_${idempotencyKey.slice(0, 8)}`,
      };
    }
    this.appliedAdjustments.add(idempotencyKey);

    account.balance = account.balance.plus(delta);
    account.equity = account.equity.plus(delta);
    account.sequence += 1n;

    return {
      requested: true,
      confirmed: true,
      detail: `Mock simulated balance adjusted by ${delta.format()}: ${reason}`,
      providerRef: `mockadj_${idempotencyKey.slice(0, 8)}`,
    };
  }

  // ---- test/seed helpers, not part of the TradingProvider interface --------

  /** Drive the mock account to a given equity, as a fill would. */
  setEquity(externalAccountId: string, equity: Money, unrealised = usd('0.00')): void {
    const account = this.requireAccount(externalAccountId);
    account.equity = equity;
    account.balance = equity.minus(unrealised);
    account.unrealised = unrealised;
    account.sequence += 1n;
  }

  setPositions(
    externalAccountId: string,
    positions: { symbol: string; signedQuantity: number }[],
    workingOrders: AccountSnapshot['workingOrders'] = [],
  ): void {
    const account = this.requireAccount(externalAccountId);
    account.positions = positions;
    account.workingOrders = workingOrders;
    account.sequence += 1n;
  }

  isTradingDisabled(externalAccountId: string): boolean {
    return this.requireAccount(externalAccountId).tradingDisabled;
  }

  private requireAccount(externalAccountId: string): MockAccountState {
    const account = this.accounts.get(externalAccountId);
    if (!account) {
      throw new Error(`Mock provider has no account ${externalAccountId}`);
    }
    return account;
  }
}

function serialiseRisk(configuration: RiskConfiguration) {
  return {
    maxMicroEquivalents: configuration.maxMicroEquivalents,
    dailyLossLimit: configuration.dailyLossLimit.toDecimalString(),
    trailingThreshold: configuration.trailingThreshold.toDecimalString(),
    allowedSymbols: configuration.allowedSymbols,
  };
}
