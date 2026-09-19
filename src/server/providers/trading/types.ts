/**
 * Trading provider adapter interface.
 *
 * IMPORTANT: every method name below is OUR internal vocabulary. None of them
 * is a claim that Tradovate exposes an endpoint by that name, or any endpoint
 * with that capability at all. Standard retail API access must not be assumed
 * to permit creating other people's customers, credentials, simulated accounts,
 * balance adjustments or partner risk settings.
 *
 * Each capability therefore carries an explicit support level. An adapter that
 * cannot do something declares UNSUPPORTED or UNVERIFIED and THROWS when the
 * capability is invoked, rather than returning a plausible-looking success.
 * A silent success here would mark an account active that does not exist, or
 * report risk limits as applied when nothing was configured.
 *
 * See docs/TRADOVATE_CAPABILITIES.md for what has actually been verified.
 */

import type { Money } from '@/domain/money/money';

export type CapabilitySupport =
  /** Confirmed against current official documentation AND a working call. */
  | 'VERIFIED'
  /**
   * Implemented against the provider's official API specification, but never
   * exercised against real credentials.
   *
   * A distinct level because "we read the spec" and "we called it and it
   * worked" are genuinely different states, and collapsing them is how an
   * integration gets declared finished a week before it is. A DOCUMENTED
   * capability runs OUTSIDE production — which is the only way it can ever be
   * exercised and promoted — and refuses inside it.
   */
  | 'DOCUMENTED'
  /** Plausibly available but not yet confirmed against docs or credentials. */
  | 'UNVERIFIED'
  /** Confirmed NOT available under the current agreement or API tier. */
  | 'UNSUPPORTED'
  /** Exists only in the mock adapter, for local development. */
  | 'MOCK_ONLY';

export interface TradingProviderCapabilities {
  readonly createCustomerIdentity: CapabilitySupport;
  readonly linkExistingIdentity: CapabilitySupport;
  readonly provisionSimulatedAccount: CapabilitySupport;
  readonly secureCredentialDelivery: CapabilitySupport;
  readonly configureRisk: CapabilitySupport;
  readonly readBackRiskConfiguration: CapabilitySupport;
  readonly authoritativeEquityStream: CapabilitySupport;
  readonly authoritativeOrderAndFillStream: CapabilitySupport;
  readonly disableTrading: CapabilitySupport;
  readonly flattenPositions: CapabilitySupport;
  readonly adjustSimBalance: CapabilitySupport;
  readonly marketDataEntitlements: CapabilitySupport;
  readonly commissionSchedule: CapabilitySupport;
  readonly eventReplay: CapabilitySupport;
}

export class CapabilityNotAvailableError extends Error {
  constructor(
    readonly capability: keyof TradingProviderCapabilities,
    readonly support: CapabilitySupport,
    readonly guidance: string,
  ) {
    super(
      `Trading provider capability "${capability}" is ${support}. ${guidance} ` +
        'Refusing to report success for an operation that did not happen.',
    );
    this.name = 'CapabilityNotAvailableError';
  }
}

export interface ProvisionAccountRequest {
  readonly orderId: string;
  readonly userId: string;
  readonly email: string;
  readonly legalName: string;
  readonly planKey: string;
  readonly startingBalance: Money;
  /** Makes a retried provisioning call safe. */
  readonly idempotencyKey: string;
}

export interface ProvisionAccountResult {
  readonly externalAccountId: string;
  /** Provider's own job/request identifier, when it exposes one. */
  readonly externalJobRef: string | null;
  /**
   * How the trader will actually get in. Never a reusable plaintext password:
   * an invitation or a scoped token is the only acceptable shape.
   */
  readonly accessDelivery:
    | { readonly kind: 'INVITATION_SENT'; readonly detail: string }
    | { readonly kind: 'SCOPED_TOKEN'; readonly expiresAt: string; readonly detail: string }
    | { readonly kind: 'MOCK'; readonly detail: string };
}

export interface RiskConfiguration {
  readonly maxMicroEquivalents: number;
  readonly dailyLossLimit: Money;
  readonly trailingThreshold: Money;
  readonly allowedSymbols: readonly string[];
}

export interface RiskVerification {
  /** True only when the settings were READ BACK and matched what we sent. */
  readonly verified: boolean;
  readonly appliedAt: string;
  /** Raw provider response evidence, stored for audit. */
  readonly evidence: string;
  readonly mismatches: readonly string[];
}

export interface AccountSnapshot {
  readonly externalAccountId: string;
  readonly equity: Money;
  readonly balance: Money;
  readonly unrealised: Money;
  readonly commissions: Money;
  readonly positions: readonly { symbol: string; signedQuantity: number }[];
  readonly workingOrders: readonly {
    symbol: string;
    signedQuantity: number;
    intent: 'INCREASE' | 'REDUCE';
    ocoGroupId: string | null;
  }[];
  readonly sequence: bigint;
  readonly sourceTimestamp: string;
}

export interface ActionResult {
  /** Requested is not the same as completed. */
  readonly requested: true;
  /** True only on positive confirmation from the provider. */
  readonly confirmed: boolean;
  readonly detail: string;
  readonly providerRef: string | null;
}

export interface TradingProvider {
  readonly name: string;
  readonly mode: 'MOCK' | 'SANDBOX' | 'PRODUCTION';
  readonly capabilities: TradingProviderCapabilities;

  provisionAccount(request: ProvisionAccountRequest): Promise<ProvisionAccountResult>;

  configureRisk(
    externalAccountId: string,
    configuration: RiskConfiguration,
  ): Promise<RiskVerification>;

  fetchAccountSnapshot(externalAccountId: string): Promise<AccountSnapshot>;

  /** Ask the provider to stop the account trading. Confirmation is separate. */
  disableTrading(externalAccountId: string, reason: string): Promise<ActionResult>;

  flattenPositions(externalAccountId: string, reason: string): Promise<ActionResult>;

  /** Simulated balance deduction for a paid reward. */
  adjustSimBalance(
    externalAccountId: string,
    delta: Money,
    reason: string,
    idempotencyKey: string,
  ): Promise<ActionResult>;
}

/** Throws unless the capability is usable right now. */
export function requireCapability(
  provider: TradingProvider,
  capability: keyof TradingProviderCapabilities,
  guidance: string,
): void {
  const support = provider.capabilities[capability];
  if (support === 'VERIFIED') return;
  if (support === 'MOCK_ONLY' && provider.mode === 'MOCK') return;
  // DOCUMENTED is the only level that behaves differently by environment: it is
  // code written from the spec and never run, so it is allowed to run in
  // staging precisely so somebody can find out whether it works, and refused in
  // production because nobody has yet.
  if (support === 'DOCUMENTED' && provider.mode !== 'PRODUCTION') return;
  throw new CapabilityNotAvailableError(capability, support, guidance);
}

/** Capabilities that must be VERIFIED before any production sale. */
export const CAPABILITIES_REQUIRED_FOR_LAUNCH: readonly (keyof TradingProviderCapabilities)[] = [
  'provisionSimulatedAccount',
  'secureCredentialDelivery',
  'configureRisk',
  'readBackRiskConfiguration',
  'authoritativeEquityStream',
  'disableTrading',
  'flattenPositions',
  'adjustSimBalance',
];

export function unverifiedLaunchCapabilities(
  provider: TradingProvider,
): { capability: string; support: CapabilitySupport }[] {
  return CAPABILITIES_REQUIRED_FOR_LAUNCH.filter(
    (c) => provider.capabilities[c] !== 'VERIFIED',
  ).map((c) => ({ capability: c, support: provider.capabilities[c] }));
}
