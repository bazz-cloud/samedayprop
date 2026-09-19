/**
 * Provider selection.
 *
 * One place decides which adapter is in use, and it refuses to hand back a mock
 * in production. Scattering `if (isDemo)` checks through the services would
 * eventually miss one, and the failure mode of missing one is taking real money
 * through a fake checkout.
 */

import { getConfig } from '@/server/config';
import { MockPaymentProvider } from './payments/mock';
import type { PaymentProvider } from './payments/types';
import { MockTradingProvider } from './trading/mock';
import { TradovateProvider } from './trading/tradovate';
import { RithmicProvider } from './trading/rithmic';
import { DEFAULT_PLATFORM, type PlatformKey } from '@/domain/catalog/platforms';
import type { TradingProvider } from './trading/types';

let paymentProvider: PaymentProvider | null = null;
let tradingProvider: TradingProvider | null = null;
const mockProviders = new Map<PlatformKey, TradingProvider>();

export function getPaymentProvider(): PaymentProvider {
  if (paymentProvider) return paymentProvider;
  const config = getConfig();

  if (config.providers.payments.driver === 'mock') {
    if (config.mode === 'PRODUCTION') {
      throw new Error('Refusing to use the mock payment provider in PRODUCTION');
    }
    paymentProvider = new MockPaymentProvider(
      process.env.PAYMENTS_WEBHOOK_SECRET ?? 'mock-webhook-secret',
    );
    return paymentProvider;
  }

  throw new Error(
    'A hosted payment provider is configured but no adapter is implemented. Implement the ' +
      'adapter against the provider you have actually contracted with, using a hosted or ' +
      'tokenised payment page so card data never reaches this application.',
  );
}

/**
 * The adapter for a platform.
 *
 * Takes the platform the customer chose, because the two are not
 * interchangeable: Tradovate is a REST partner API this application can call,
 * and Rithmic is a native library behind an FCM relationship that it cannot.
 * Defaulting the argument keeps every existing call site working and means an
 * account provisioned before the choice existed still resolves.
 */
export function getTradingProvider(platform: PlatformKey = DEFAULT_PLATFORM): TradingProvider {
  const config = getConfig();

  if (config.providers.trading.driver === 'mock') {
    if (config.mode === 'PRODUCTION') {
      throw new Error('Refusing to use the mock trading provider in PRODUCTION');
    }
    // Cached per platform so a demo account on each one keeps its own state.
    const cached = mockProviders.get(platform);
    if (cached) return cached;
    const created = new MockTradingProvider();
    mockProviders.set(platform, created);
    return created;
  }

  if (platform === 'RITHMIC') {
    return new RithmicProvider(config.mode === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX');
  }

  tradingProvider ??= new TradovateProvider(
    config.mode === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX',
    config.providers.trading.baseUrl!,
    process.env.TRADOVATE_API_KEY!,
  );
  return tradingProvider;
}

/** Test hook so a suite can inject scripted adapters. */
export function __setProvidersForTesting(
  payments: PaymentProvider | null,
  trading: TradingProvider | null,
): void {
  paymentProvider = payments;
  tradingProvider = trading;
  // The per-platform mock cache has to go with it, or a test that installs its
  // own provider still gets yesterday's mock for whichever platform it asks for.
  mockProviders.clear();
  if (trading) {
    for (const platform of ['TRADOVATE', 'RITHMIC'] as const) mockProviders.set(platform, trading);
  }
}
