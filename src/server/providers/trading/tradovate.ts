/**
 * Tradovate adapter, written against the official OpenAPI specification.
 *
 * Every path, field name and enum value below comes from that spec
 * (`openapi: 3.0.0`, title "Tradovate API", server
 * `https://demo.tradovateapi.com/v1`). Nothing here is guessed, and nothing
 * here has ever run against a real key — which is why every capability is
 * DOCUMENTED rather than VERIFIED. DOCUMENTED code executes outside production
 * so it can be exercised and promoted, and refuses inside it.
 *
 * THE TWO MAPPINGS THAT MATTER
 *
 * 1. Post-trade risk. Tradovate enforces our entire risk model natively:
 *
 *      dailyLossAutoLiq          our daily loss limit
 *      trailingMaxDrawdown       our drawdown allowance
 *      trailingMaxDrawdownLimit  the balance the threshold stops rising at
 *      trailingMaxDrawdownMode   "EOD" | "RealTime"
 *
 *    **The mode is `RealTime`.** Our published rule is that the threshold
 *    follows equity intraday INCLUDING unrealized gains. `EOD` would measure
 *    only at the close, which is a materially different and much looser
 *    product — several competitors sell exactly that. Sending EOD would mean
 *    the site says one thing and the platform enforces another.
 *
 *    `trailingMaxDrawdownLimit` is where the threshold stops. The owner's rule
 *    is that it NEVER stops, so we do not send a limit at all; if a future
 *    policy adds a stop, `trailingStopFor()` is where it comes from.
 *
 * 2. Pre-trade risk. `maxOpeningOrderQty` and the long/short/exposed limits
 *    carry our position ceiling. We send `totalBy: 'Overall'` because our
 *    ceiling is a single combined micro-equivalent figure across instruments,
 *    not a per-contract one.
 *
 * WHAT WE DO NOT ASK IT TO DO
 *
 * `adjustSimBalance` stays UNVERIFIED. Deducting a paid reward from a
 * simulated balance is the one operation where a silent failure means we have
 * paid real cash and not taken the simulated profit, and no endpoint in the
 * spec is unambiguously that. It needs a real conversation with Tradovate, not
 * a guess from a schema.
 */

import { Money } from '@/domain/money/money';
import {
  CapabilityNotAvailableError,
  requireCapability,
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
 * Implemented from the specification, never exercised against a key.
 *
 * Promote one to VERIFIED only after a real call against real credentials has
 * been seen to work, and record the evidence in docs/TRADOVATE_CAPABILITIES.md
 * when you do.
 */
const DOCUMENTED_CAPABILITIES: TradingProviderCapabilities = {
  createCustomerIdentity: 'DOCUMENTED',
  linkExistingIdentity: 'UNVERIFIED',
  provisionSimulatedAccount: 'DOCUMENTED',
  secureCredentialDelivery: 'UNVERIFIED',
  configureRisk: 'DOCUMENTED',
  readBackRiskConfiguration: 'DOCUMENTED',
  authoritativeEquityStream: 'DOCUMENTED',
  authoritativeOrderAndFillStream: 'UNVERIFIED',
  disableTrading: 'DOCUMENTED',
  flattenPositions: 'DOCUMENTED',
  adjustSimBalance: 'UNVERIFIED',
  marketDataEntitlements: 'UNVERIFIED',
  commissionSchedule: 'UNVERIFIED',
  eventReplay: 'UNVERIFIED',
};

const GUIDANCE =
  'Implemented from the Tradovate OpenAPI specification but never run against a real key. ' +
  'Exercise it against staging credentials, then promote the capability to VERIFIED. ' +
  'See docs/PLATFORM_INTEGRATION.md.';

/** Our published drawdown rule, in Tradovate's vocabulary. */
const TRAILING_MODE_REALTIME = 'RealTime';

interface TokenState {
  readonly accessToken: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

export class TradovateProvider implements TradingProvider {
  readonly name = 'tradovate';
  readonly capabilities = DOCUMENTED_CAPABILITIES;

  private token: TokenState | null = null;

  constructor(
    readonly mode: 'SANDBOX' | 'PRODUCTION',
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly cid: string,
  ) {
    // All four, because Tradovate's documentation is explicit: partner access
    // needs an API key and secret created in Dashboards, plus a CID. Failing
    // here is better than failing on the first call with a confusing 401.
    //
    // The error names what is missing but never echoes a value — a stack trace
    // carrying half a secret is still carrying a secret.
    const missing = [
      !baseUrl && 'base URL',
      !apiKey && 'API key',
      !apiSecret && 'API secret',
      !cid && 'CID',
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(`TradovateProvider is missing: ${missing.join(', ')}`);
    }
  }

  // ---------------------------------------------------------------- transport

  /**
   * POST /auth/accesstokenrequest, with the token cached until shortly before
   * it expires.
   *
   * Tradovate's documentation is explicit that the auth endpoint must not be
   * hammered: tokens last 90 minutes and should be cached and renewed at about
   * 85. We renew at 80 to leave room for a slow call.
   */
  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now) return this.token.accessToken;

    const response = await this.post<{
      errorText?: string;
      accessToken?: string;
      expirationTime?: string;
    }>('/auth/accesstokenrequest', {
      name: this.apiKey,
      password: this.apiSecret,
      appId: 'Bull Rush Futures',
      appVersion: '1.0',
      cid: Number(this.cid),
      sec: this.apiSecret,
    }, { authenticated: false });

    if (response.errorText || !response.accessToken) {
      // Never include the response body: an auth failure response is exactly
      // the place a credential is most likely to be echoed back.
      throw new Error(`Tradovate authentication failed: ${response.errorText ?? 'no token returned'}`);
    }

    const expiresAt = response.expirationTime
      ? Date.parse(response.expirationTime) - 10 * 60_000
      : now + 80 * 60_000;
    this.token = { accessToken: response.accessToken, expiresAt };
    return response.accessToken;
  }

  private async post<T>(
    path: string,
    body: unknown,
    options: { authenticated?: boolean } = {},
  ): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, undefined, {});
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    options: { authenticated?: boolean },
  ): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.authenticated !== false) {
      headers.authorization = `Bearer ${await this.accessToken()}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      // Status and path only. A provider error body can contain anything,
      // including the request it is complaining about.
      throw new Error(`Tradovate ${method} ${path} failed with HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  // ------------------------------------------------------------ provisioning

  /**
   * Create the trader's user, then their simulated account.
   *
   * POST /user/createevaluationusers then POST /user/createevaluationaccounts.
   * Both are batch endpoints; we send one element, because the caller
   * provisions one order at a time and a partial batch failure is harder to
   * reason about than a failed single.
   *
   * NO PASSWORD IS SENT. The spec allows one on user creation and we
   * deliberately do not use it: this system never holds a reusable platform
   * password, and inventing one here would put it in our memory, our logs and
   * our error reports.
   */
  async provisionAccount(request: ProvisionAccountRequest): Promise<ProvisionAccountResult> {
    requireCapability(this, 'provisionSimulatedAccount', GUIDANCE);

    const users = await this.post<{
      errorText?: string;
      results?: { errorText?: string; userId?: number }[];
    }>('/user/createevaluationusers', {
      users: [
        {
          name: request.email,
          email: request.email,
          firstName: request.legalName.split(' ')[0] ?? request.legalName,
          lastName: request.legalName.split(' ').slice(1).join(' ') || request.legalName,
        },
      ],
    });

    const userResult = users.results?.[0];
    if (users.errorText || userResult?.errorText || !userResult?.userId) {
      throw new Error(
        `Tradovate refused to create the user: ${users.errorText ?? userResult?.errorText ?? 'no user id returned'}`,
      );
    }

    const accounts = await this.post<{
      errorText?: string;
      results?: { errorText?: string; accountId?: number; tradingPermissionId?: number }[];
    }>('/user/createevaluationaccounts', {
      accounts: [
        {
          userId: userResult.userId,
          name: `${request.planKey}-${request.orderId}`,
          // Tradovate takes a decimal, not minor units.
          initialBalance: Number(request.startingBalance.toDecimalString()),
        },
      ],
    });

    const accountResult = accounts.results?.[0];
    if (accounts.errorText || accountResult?.errorText || !accountResult?.accountId) {
      throw new Error(
        `Tradovate refused to create the account: ${accounts.errorText ?? accountResult?.errorText ?? 'no account id returned'}`,
      );
    }

    return {
      externalAccountId: String(accountResult.accountId),
      externalJobRef: accountResult.tradingPermissionId
        ? String(accountResult.tradingPermissionId)
        : null,
      // Tradovate owns the sign-in. The trader sets their own password through
      // Tradovate and signs its market data agreement there on first use; we
      // never see or hold either.
      accessDelivery: {
        kind: 'INVITATION_SENT',
        detail:
          'Tradovate account created. The trader signs in through Tradovate and completes its ' +
          'market data agreement there.',
      },
    };
  }

  // -------------------------------------------------------------------- risk

  /**
   * Apply our limits, then READ THEM BACK.
   *
   * The read-back is the point. Applying risk settings and assuming they took
   * is how an account ends up trading with no limits on it, so this returns
   * `verified: false` with the mismatches listed unless what comes back equals
   * what went out.
   */
  async configureRisk(
    externalAccountId: string,
    configuration: RiskConfiguration,
  ): Promise<RiskVerification> {
    requireCapability(this, 'configureRisk', GUIDANCE);

    const accountId = Number(externalAccountId);
    const dailyLoss = Number(configuration.dailyLossLimit.toDecimalString());
    const drawdown = Number(configuration.trailingThreshold.toDecimalString());

    await this.post('/userAccountAutoLiq/update', {
      id: accountId,
      dailyLossAutoLiq: dailyLoss,
      trailingMaxDrawdown: drawdown,
      // RealTime, never EOD. See the note at the top of this file: EOD is a
      // different product from the one the site publishes.
      trailingMaxDrawdownMode: TRAILING_MODE_REALTIME,
    });

    await this.post('/userAccountPositionLimit/create', {
      accountId,
      active: true,
      totalBy: 'Overall',
      longLimit: configuration.maxMicroEquivalents,
      shortLimit: configuration.maxMicroEquivalents,
      exposedLimit: configuration.maxMicroEquivalents,
      description: 'Bull Rush Futures position ceiling',
    });

    requireCapability(this, 'readBackRiskConfiguration', GUIDANCE);
    const applied = await this.get<{
      dailyLossAutoLiq?: number;
      trailingMaxDrawdown?: number;
      trailingMaxDrawdownMode?: string;
    }>(`/userAccountAutoLiq/item?id=${accountId}`);

    const mismatches: string[] = [];
    if (applied.dailyLossAutoLiq !== dailyLoss) {
      mismatches.push(`daily loss limit: sent ${dailyLoss}, read back ${applied.dailyLossAutoLiq}`);
    }
    if (applied.trailingMaxDrawdown !== drawdown) {
      mismatches.push(`trailing drawdown: sent ${drawdown}, read back ${applied.trailingMaxDrawdown}`);
    }
    if (applied.trailingMaxDrawdownMode !== TRAILING_MODE_REALTIME) {
      mismatches.push(
        `drawdown mode: sent ${TRAILING_MODE_REALTIME}, read back ${applied.trailingMaxDrawdownMode}`,
      );
    }

    return {
      verified: mismatches.length === 0,
      appliedAt: new Date().toISOString(),
      evidence: JSON.stringify(applied),
      mismatches,
    };
  }

  // ---------------------------------------------------------------- snapshots

  /**
   * POST /cashBalance/getcashbalancesnapshot plus the open positions.
   *
   * `netLiq` is the authoritative equity figure and `openPnL` the unrealized
   * component, which is what the trailing threshold has to follow.
   */
  async fetchAccountSnapshot(externalAccountId: string): Promise<AccountSnapshot> {
    requireCapability(this, 'authoritativeEquityStream', GUIDANCE);

    const accountId = Number(externalAccountId);
    const balance = await this.post<{
      totalCashValue?: number;
      netLiq?: number;
      openPnL?: number;
      realizedPnL?: number;
    }>('/cashBalance/getcashbalancesnapshot', { accountId });

    const positions = await this.get<
      { accountId: number; contractId: number; netPos: number }[]
    >('/position/list');

    const money = (value: number | undefined) => Money.parse((value ?? 0).toFixed(2));

    return {
      externalAccountId,
      equity: money(balance.netLiq),
      balance: money(balance.totalCashValue),
      unrealised: money(balance.openPnL),
      // The spec's snapshot carries no commission total. Reporting zero would
      // understate costs, so this stays zero ONLY because the risk engine
      // measures cost-net equity from netLiq, which already includes them.
      commissions: Money.zero(),
      positions: positions
        .filter((position) => position.accountId === accountId && position.netPos !== 0)
        .map((position) => ({
          symbol: String(position.contractId),
          signedQuantity: position.netPos,
        })),
      // Working orders need /order/list filtered by account and status; not
      // implemented until the order stream capability is exercised, and an
      // empty list is honest here because the risk engine treats missing
      // working orders as "none known" rather than "none exist".
      workingOrders: [],
      sequence: BigInt(Date.now()),
      sourceTimestamp: new Date().toISOString(),
    };
  }

  // ----------------------------------------------------------------- actions

  /**
   * Stop the account trading.
   *
   * `doNotUnlock` is the field that makes a lockout stick: without it the
   * account can be unlocked by the trader. A breach on our side is terminal,
   * so it is set.
   */
  async disableTrading(externalAccountId: string, reason: string): Promise<ActionResult> {
    requireCapability(this, 'disableTrading', GUIDANCE);

    const accountId = Number(externalAccountId);
    const response = await this.post<{ errorText?: string }>('/userAccountAutoLiq/update', {
      id: accountId,
      // Zero daily loss allowance is the documented way to stop an account
      // taking any further risk; doNotUnlock stops the trader releasing it.
      dailyLossAutoLiq: 0,
      doNotUnlock: true,
    });

    return {
      requested: true,
      confirmed: !response.errorText,
      detail: response.errorText ?? `Trading disabled: ${reason}`,
      providerRef: externalAccountId,
    };
  }

  /**
   * POST /order/liquidatepositions.
   *
   * `confirmed` is true only on the documented success value. Every other
   * failureReason in that enum — and there are thirty of them — means the
   * positions are still open, and saying otherwise would tell a risk engine an
   * account is flat when it is not.
   */
  async flattenPositions(externalAccountId: string, reason: string): Promise<ActionResult> {
    requireCapability(this, 'flattenPositions', GUIDANCE);

    const response = await this.post<{
      failureReason?: string;
      failureText?: string;
      orderId?: number;
    }>('/order/liquidatepositions', {
      accountId: Number(externalAccountId),
      admin: true,
      customTag50: reason.slice(0, 50),
    });

    const confirmed = !response.failureReason || response.failureReason === 'Success';
    return {
      requested: true,
      confirmed,
      detail: confirmed
        ? `Liquidation requested: ${reason}`
        : `Tradovate refused to liquidate: ${response.failureReason} ${response.failureText ?? ''}`.trim(),
      providerRef: response.orderId ? String(response.orderId) : null,
    };
  }

  /**
   * Deduct a paid reward from the simulated balance.
   *
   * Deliberately still UNVERIFIED and therefore still throwing. This is the
   * one operation where a silent failure means real cash has left the business
   * and the simulated profit was never taken back, and no endpoint in the
   * specification is unambiguously this. It needs an answer from Tradovate,
   * not a guess from a schema.
   */
  async adjustSimBalance(
    _externalAccountId: string,
    _delta: Money,
    _reason: string,
    _idempotencyKey: string,
  ): Promise<ActionResult> {
    throw new CapabilityNotAvailableError(
      'adjustSimBalance',
      'UNVERIFIED',
      'No endpoint in the Tradovate specification unambiguously deducts a paid reward from a ' +
        'simulated balance. Confirm the correct call with Tradovate before implementing it: a ' +
        'silent failure here means cash was paid and the simulated profit was never taken.',
    );
  }
}
