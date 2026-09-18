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
import type { TradingProvider } from './trading/types';

let paymentProvider: PaymentProvider | null = null;
let tradingProvider: TradingProvider | null = null;

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

export function getTradingProvider(): TradingProvider {
  if (tradingProvider) return tradingProvider;
  const config = getConfig();

  if (config.providers.trading.driver === 'mock') {
    if (config.mode === 'PRODUCTION') {
      throw new Error('Refusing to use the mock trading provider in PRODUCTION');
    }
    tradingProvider = new MockTradingProvider();
    return tradingProvider;
  }

  tradingProvider = new TradovateProvider(
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
}
