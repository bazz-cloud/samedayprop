/**
 * Tradovate adapter — DELIBERATELY UNIMPLEMENTED.
 *
 * Nothing in this file calls a Tradovate endpoint, because no endpoint has been
 * verified. Inventing a URL here would be worse than leaving it empty: it would
 * look like an integration, pass a cursory review, and fail against the real
 * partner API in production.
 *
 * WHAT TRADOVATE'S OWN DOCUMENTATION STATES (read 2026-09-19, not yet exercised
 * against a key, so every capability below stays UNVERIFIED):
 *
 *  - Access needs THREE things together: organization admin credentials, an API
 *    key, and a CID. An Evaluation Support representative issues them.
 *  - Hosts. Production: live.tradovateapi.com (live), demo.tradovateapi.com
 *    (SIMULATION engine), md.tradovateapi.com (market data). Staging:
 *    live-api / demo-api / md-api .staging.ninjatrader.dev.
 *    `demo.` is a PRODUCTION host serving the simulation engine — it is not a
 *    test environment, and this business runs against it in production.
 *  - Partners can create organization members individually or in bulk, add and
 *    cancel entitlements and subscription plans, create simulation accounts
 *    individually or in bulk, grant trading permissions, apply pre- and
 *    post-trade risk settings, halt trading for a risk category or the whole
 *    organization, and expire manual lockouts a trader placed on themselves.
 *  - Real-time events come over a WebSocket, not by polling.
 *  - "Relaxed REST": POST when sending a JSON body, GET when not. All responses
 *    are JSON.
 *
 * Every one of those maps onto a capability in this interface, which is why the
 * capability list is not being rewritten — what is missing is a working call,
 * not knowledge of what to call. VERIFIED in this codebase means documentation
 * AND a successful call, and no call has been made.
 *
 * Every capability is UNVERIFIED, so `requireCapability` throws before any
 * method body runs. To implement this adapter:
 *
 *  1. Read the current official Tradovate API documentation and the partner
 *     agreement actually in force.
 *  2. Confirm, per capability, that the tier of access being purchased permits
 *     it — especially creating customer identities, provisioning simulated
 *     accounts for other people, setting partner risk parameters, and adjusting
 *     simulated balances. Retail API access should be assumed NOT to include
 *     these until proven otherwise.
 *  3. Record what was confirmed, with source links and dates, in
 *     docs/TRADOVATE_CAPABILITIES.md.
 *  4. Flip the capability from UNVERIFIED to VERIFIED or UNSUPPORTED here, and
 *     implement only the VERIFIED ones.
 *
 * Capabilities that turn out to be UNSUPPORTED need a product decision, not a
 * workaround: if simulated balance deduction is not available through the API,
 * the payout flow needs a documented manual procedure with its own controls.
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

const UNVERIFIED_CAPABILITIES: TradingProviderCapabilities = {
  createCustomerIdentity: 'UNVERIFIED',
  linkExistingIdentity: 'UNVERIFIED',
  provisionSimulatedAccount: 'UNVERIFIED',
  secureCredentialDelivery: 'UNVERIFIED',
  configureRisk: 'UNVERIFIED',
  readBackRiskConfiguration: 'UNVERIFIED',
  authoritativeEquityStream: 'UNVERIFIED',
  authoritativeOrderAndFillStream: 'UNVERIFIED',
  disableTrading: 'UNVERIFIED',
  flattenPositions: 'UNVERIFIED',
  adjustSimBalance: 'UNVERIFIED',
  marketDataEntitlements: 'UNVERIFIED',
  commissionSchedule: 'UNVERIFIED',
  eventReplay: 'UNVERIFIED',
};

const GUIDANCE =
  'No Tradovate endpoint has been verified for this operation. Confirm it against current ' +
  'official documentation and the partner agreement, record the evidence in ' +
  'docs/TRADOVATE_CAPABILITIES.md, then implement it here.';

export class TradovateProvider implements TradingProvider {
  readonly name = 'tradovate';
  readonly capabilities = UNVERIFIED_CAPABILITIES;

  constructor(
    readonly mode: 'SANDBOX' | 'PRODUCTION',
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly cid: string,
  ) {
    // All three, because Tradovate's documentation is explicit that access
    // needs organization admin credentials, an API key and a CID. Failing here
    // is better than failing on the first call with a confusing 401.
    if (!baseUrl || !apiKey || !cid) {
      throw new Error('TradovateProvider requires a base URL, an API key and a CID');
    }
  }

  async provisionAccount(_request: ProvisionAccountRequest): Promise<ProvisionAccountResult> {
    throw new CapabilityNotAvailableError('provisionSimulatedAccount', 'UNVERIFIED', GUIDANCE);
  }

  async configureRisk(
    _externalAccountId: string,
    _configuration: RiskConfiguration,
  ): Promise<RiskVerification> {
    throw new CapabilityNotAvailableError('configureRisk', 'UNVERIFIED', GUIDANCE);
  }

  async fetchAccountSnapshot(_externalAccountId: string): Promise<AccountSnapshot> {
    throw new CapabilityNotAvailableError('authoritativeEquityStream', 'UNVERIFIED', GUIDANCE);
  }

  async disableTrading(_externalAccountId: string, _reason: string): Promise<ActionResult> {
    throw new CapabilityNotAvailableError('disableTrading', 'UNVERIFIED', GUIDANCE);
  }

  async flattenPositions(_externalAccountId: string, _reason: string): Promise<ActionResult> {
    throw new CapabilityNotAvailableError('flattenPositions', 'UNVERIFIED', GUIDANCE);
  }

  async adjustSimBalance(
    _externalAccountId: string,
    _delta: Money,
    _reason: string,
    _idempotencyKey: string,
  ): Promise<ActionResult> {
    throw new CapabilityNotAvailableError('adjustSimBalance', 'UNVERIFIED', GUIDANCE);
  }
}
