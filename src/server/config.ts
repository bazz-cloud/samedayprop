/**
 * Runtime configuration and the launch gate.
 *
 * Three modes, with strictly separated credentials and databases:
 *
 *   DEMO       everything mocked, obvious banner, no real money, no real email.
 *   SANDBOX    provider sandboxes with test credentials. Still not real money.
 *   PRODUCTION real customers and real money.
 *
 * The rule enforced here: PRODUCTION NEVER FALLS BACK TO A MOCK. If a real
 * provider is not configured, the application refuses to start in production
 * rather than quietly serving a simulated payment page. A silent mock in
 * production would take a customer's money and create nothing.
 */

export type AppMode = 'DEMO' | 'SANDBOX' | 'PRODUCTION';

export interface ProviderConfig {
  readonly payments: {
    readonly driver: 'mock' | 'hosted';
    readonly configured: boolean;
    readonly publicKey: string | null;
  };
  readonly trading: {
    readonly driver: 'mock' | 'tradovate';
    readonly configured: boolean;
    readonly baseUrl: string | null;
  };
  readonly email: {
    readonly driver: 'local-outbox' | 'smtp';
    readonly configured: boolean;
  };
}

export interface CompanyPlaceholders {
  readonly name: string;
  readonly legalEntity: string;
  readonly jurisdiction: string;
  readonly supportEmail: string;
  readonly postalAddress: string;
  /** True while any of the above is still a placeholder. */
  readonly incomplete: boolean;
}

export interface AppConfig {
  readonly mode: AppMode;
  readonly isDemo: boolean;
  readonly providers: ProviderConfig;
  readonly company: CompanyPlaceholders;
  readonly sessionSecret: string;
  readonly baseUrl: string;
  /** Session cookies require HTTPS outside local development. */
  readonly secureCookies: boolean;
}

function env(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

const PLACEHOLDER_PREFIX = 'PLACEHOLDER';

function readCompany(): CompanyPlaceholders {
  const name = env('COMPANY_NAME') ?? 'Bull Rush Futures';
  const legalEntity = env('COMPANY_LEGAL_ENTITY') ?? `${PLACEHOLDER_PREFIX} legal entity name`;
  const jurisdiction = env('COMPANY_JURISDICTION') ?? `${PLACEHOLDER_PREFIX} jurisdiction`;
  const supportEmail = env('COMPANY_SUPPORT_EMAIL') ?? 'support@example.invalid';
  const postalAddress = env('COMPANY_POSTAL_ADDRESS') ?? `${PLACEHOLDER_PREFIX} postal address`;

  // The trading name is supplied; the registrable details are not, and those
  // are what legal documents and the launch gate actually depend on.
  const incomplete =
    [legalEntity, jurisdiction, postalAddress].some((v) => v.includes(PLACEHOLDER_PREFIX)) ||
    supportEmail.endsWith('.invalid');

  return { name, legalEntity, jurisdiction, supportEmail, postalAddress, incomplete };
}

function readMode(): AppMode {
  const raw = (env('APP_MODE') ?? 'DEMO').toUpperCase();
  if (raw === 'DEMO' || raw === 'SANDBOX' || raw === 'PRODUCTION') return raw;
  throw new Error(`APP_MODE must be DEMO, SANDBOX or PRODUCTION; received ${raw}`);
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;

  const mode = readMode();
  const paymentsConfigured = Boolean(env('PAYMENTS_PUBLIC_KEY') && env('PAYMENTS_SECRET_KEY'));
  const tradingConfigured = Boolean(env('TRADOVATE_BASE_URL') && env('TRADOVATE_API_KEY'));
  const emailConfigured = Boolean(env('SMTP_URL'));

  const providers: ProviderConfig = {
    payments: {
      driver: paymentsConfigured ? 'hosted' : 'mock',
      configured: paymentsConfigured,
      publicKey: env('PAYMENTS_PUBLIC_KEY') ?? null,
    },
    trading: {
      driver: tradingConfigured ? 'tradovate' : 'mock',
      configured: tradingConfigured,
      baseUrl: env('TRADOVATE_BASE_URL') ?? null,
    },
    email: {
      driver: emailConfigured ? 'smtp' : 'local-outbox',
      configured: emailConfigured,
    },
  };

  if (mode === 'PRODUCTION') {
    const missing: string[] = [];
    if (!providers.payments.configured) missing.push('payment provider');
    if (!providers.trading.configured) missing.push('trading provider');
    if (!providers.email.configured) missing.push('email provider');
    if (missing.length > 0) {
      throw new Error(
        `Refusing to start in PRODUCTION with an unconfigured ${missing.join(', ')}. ` +
          'Mock adapters are never used in production: a simulated payment page would take ' +
          'real money and provision nothing. Configure the provider or run in DEMO mode.',
      );
    }
  }

  const sessionSecret = env('SESSION_SECRET') ?? (mode === 'DEMO' ? 'demo-only-insecure-secret' : '');
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET is required outside DEMO mode');
  }

  cached = {
    mode,
    isDemo: mode === 'DEMO',
    providers,
    company: readCompany(),
    sessionSecret,
    baseUrl: env('APP_BASE_URL') ?? 'http://localhost:3000',
    secureCookies: mode !== 'DEMO' || Boolean(env('FORCE_SECURE_COOKIES')),
  };
  return cached;
}

/** Test hook. Never called by application code. */
export function resetConfigCache(): void {
  cached = null;
}

export interface LaunchBlocker {
  readonly area: string;
  readonly detail: string;
  readonly blocking: boolean;
}

/**
 * Everything standing between this build and taking real money.
 *
 * Rendered verbatim in the admin console and in docs/LAUNCH_CHECKLIST.md. The
 * entries marked blocking are hard gates on production checkout.
 */
export function staticLaunchBlockers(config: AppConfig): LaunchBlocker[] {
  const blockers: LaunchBlocker[] = [];

  if (!config.providers.payments.configured) {
    blockers.push({
      area: 'Payments',
      detail:
        'No hosted payment provider is configured. Checkout uses a clearly labelled mock ' +
        'that moves no money.',
      blocking: true,
    });
  }
  if (!config.providers.trading.configured) {
    blockers.push({
      area: 'Trading provider',
      detail:
        'No verified Tradovate partner credentials are configured. Account provisioning uses ' +
        'a mock adapter. Partner capabilities must be confirmed — see ' +
        'docs/TRADOVATE_CAPABILITIES.md.',
      blocking: true,
    });
  }
  if (!config.providers.email.configured) {
    blockers.push({
      area: 'Email',
      detail: 'No email provider configured. Messages are written to a local outbox only.',
      blocking: true,
    });
  }
  if (config.company.incomplete) {
    blockers.push({
      area: 'Company details',
      detail:
        'Company name, legal entity, jurisdiction and contact details are still placeholders. ' +
        'Legal documents cannot be finalised until these are supplied.',
      blocking: true,
    });
  }

  return blockers;
}
