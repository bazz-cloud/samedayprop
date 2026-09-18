/**
 * Payment provider adapter.
 *
 * Card details never touch this application. The only supported shape is a
 * HOSTED payment page or a tokenised element owned by the provider, so raw PAN
 * data never reaches our servers, our logs or our database.
 *
 * The critical modelling decision here is the UNKNOWN outcome. Real payment
 * providers time out, and "we did not get a response" is emphatically not the
 * same as "the payment failed". Everything downstream treats UNKNOWN as a state
 * to be reconciled, never as a failure to be retried blindly.
 */

import type { Money } from '@/domain/money/money';

export type PaymentStatus = 'REQUIRES_ACTION' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

export interface CreateChargeRequest {
  readonly orderId: string;
  readonly userId: string;
  readonly amount: Money;
  readonly description: string;
  /** Makes charge creation safe under retries. */
  readonly idempotencyKey: string;
  readonly returnUrl: string;
}

export interface ChargeResult {
  readonly providerRef: string;
  readonly status: PaymentStatus;
  /** Where to send the customer to complete payment, for hosted flows. */
  readonly hostedUrl: string | null;
  readonly fee: Money;
  readonly net: Money;
  readonly failureReason: string | null;
}

export interface RefundRequest {
  readonly paymentProviderRef: string;
  readonly amount: Money;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface RefundResult {
  readonly providerRef: string;
  readonly status: 'SUCCEEDED' | 'PENDING' | 'FAILED';
  readonly failureReason: string | null;
}

export interface WebhookVerification {
  readonly valid: boolean;
  readonly externalId: string | null;
  readonly eventType: string | null;
  readonly reason: string | null;
}

export interface PaymentProvider {
  readonly name: string;
  readonly mode: 'MOCK' | 'SANDBOX' | 'PRODUCTION';
  /** True when this provider actually moves money. */
  readonly movesRealMoney: boolean;

  createCharge(request: CreateChargeRequest): Promise<ChargeResult>;

  /** Authoritative server-side lookup. Never trust a client-reported outcome. */
  getCharge(providerRef: string): Promise<ChargeResult>;

  refund(request: RefundRequest): Promise<RefundResult>;

  /**
   * Verify a webhook signature and extract its delivery id.
   *
   * A delivery whose signature does not verify is discarded, never processed.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string>): WebhookVerification;
}
