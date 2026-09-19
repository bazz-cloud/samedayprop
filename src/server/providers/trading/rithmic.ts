/**
 * Rithmic adapter — DELIBERATELY UNIMPLEMENTED, and for a different reason
 * from the Tradovate one.
 *
 * Tradovate's stub is empty because nothing has been verified yet. This one is
 * empty because of an architectural fact that no amount of credentials will
 * change: R | API+ is a set of C++ and .NET libraries, not a REST API, so it
 * cannot be called from this Node application at all. Implementing this file
 * against a guessed HTTP endpoint would be inventing an API that does not
 * exist in any form.
 *
 * The second fact matters just as much commercially: Rithmic is broker- and
 * FCM-neutral infrastructure. It does not open trader accounts. A broker, FCM
 * or funding evaluator opens them and issues the credentials. So
 * `provisionSimulatedAccount` and `secureCredentialDelivery` are marked
 * UNSUPPORTED rather than UNVERIFIED: they are not things Rithmic is waiting to
 * be asked for.
 *
 * What a real Rithmic path looks like, in order:
 *
 *  1. An FCM or broker relationship that will carry the accounts.
 *  2. Request the dev kit from Rithmic, naming the API flavours needed.
 *  3. Build a separate service in C++ or .NET that speaks R | API+ and exposes
 *     an internal HTTP or queue interface this application can call. That
 *     service, not this file, is the adapter.
 *  4. Develop against Rithmic Test, then pass conformance testing before any
 *     production connection.
 *  5. Decide and document who issues the trader their sign-in, since Rithmic
 *     will not.
 *
 * See docs/PLATFORM_INTEGRATION.md.
 */

import type { Money } from '@/domain/money/money';
import {
  CapabilityNotAvailableError,
  type AccountSnapshot,
  type ActionResult,
  type ProvisionAccountRequest,
  type ProvisionAccountResult,
  type RiskConfiguration,
  type RiskVerification,
  type TradingProvider,
  type TradingProviderCapabilities,
} from './types';

/**
 * UNSUPPORTED where Rithmic structurally does not do the thing; UNVERIFIED
 * where it plausibly does but only through a service that does not exist yet.
 */
const RITHMIC_CAPABILITIES: TradingProviderCapabilities = {
  createCustomerIdentity: 'UNSUPPORTED',
  linkExistingIdentity: 'UNVERIFIED',
  provisionSimulatedAccount: 'UNSUPPORTED',
  secureCredentialDelivery: 'UNSUPPORTED',
  configureRisk: 'UNVERIFIED',
  readBackRiskConfiguration: 'UNVERIFIED',
  authoritativeEquityStream: 'UNVERIFIED',
  authoritativeOrderAndFillStream: 'UNVERIFIED',
  disableTrading: 'UNVERIFIED',
  flattenPositions: 'UNVERIFIED',
  adjustSimBalance: 'UNSUPPORTED',
  marketDataEntitlements: 'UNVERIFIED',
  commissionSchedule: 'UNVERIFIED',
  eventReplay: 'UNVERIFIED',
};

const GUIDANCE =
  'Rithmic is reached through a separate C++ or .NET service speaking R | API+, not from this ' +
  'application, and accounts are opened by an FCM or broker rather than by Rithmic. ' +
  'See docs/PLATFORM_INTEGRATION.md.';

function refuse(capability: keyof TradingProviderCapabilities): never {
  throw new CapabilityNotAvailableError(capability, RITHMIC_CAPABILITIES[capability], GUIDANCE);
}

export class RithmicProvider implements TradingProvider {
  readonly name = 'rithmic';

  constructor(readonly mode: 'MOCK' | 'SANDBOX' | 'PRODUCTION') {}

  readonly capabilities = RITHMIC_CAPABILITIES;

  async provisionAccount(_request: ProvisionAccountRequest): Promise<ProvisionAccountResult> {
    refuse('provisionSimulatedAccount');
  }

  async configureRisk(
    _externalAccountId: string,
    _configuration: RiskConfiguration,
  ): Promise<RiskVerification> {
    refuse('configureRisk');
  }

  async fetchAccountSnapshot(_externalAccountId: string): Promise<AccountSnapshot> {
    refuse('authoritativeEquityStream');
  }

  async disableTrading(_externalAccountId: string, _reason: string): Promise<ActionResult> {
    refuse('disableTrading');
  }

  async flattenPositions(_externalAccountId: string, _reason: string): Promise<ActionResult> {
    refuse('flattenPositions');
  }

  async adjustSimBalance(
    _externalAccountId: string,
    _delta: Money,
    _reason: string,
    _idempotencyKey: string,
  ): Promise<ActionResult> {
    refuse('adjustSimBalance');
  }
}
