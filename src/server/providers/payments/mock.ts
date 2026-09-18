/**
 * Mock payment provider.
 *
 * Moves no money. `movesRealMoney` is false, and the UI is required to render a
 * demo banner wherever this provider is in use so nobody can mistake the
 * checkout for a real one.
 *
 * It deliberately models the awkward cases — duplicate webhooks, unknown
 * outcomes, signature failures — because those are the paths where a payment
 * system loses money, and they need to be exercised locally.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Money } from '@/domain/money/money';
import type {
  ChargeResult,
  CreateChargeRequest,
  PaymentProvider,
  RefundRequest,
  RefundResult,
  WebhookVerification,
} from './types';

/** Assumed processing cost, used only for local modelling. */
const MOCK_FEE_PERCENT = 29n; // 2.9%
const MOCK_FEE_FIXED_MINOR = 30n; // $0.30

export interface MockPaymentScript {
  /** Force the next charge to this outcome. */
  readonly nextOutcome?: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  readonly failureReason?: string;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock-payments';
  readonly mode = 'MOCK' as const;
  readonly movesRealMoney = false;

  private readonly charges = new Map<string, ChargeResult>();
  private readonly chargesByIdempotencyKey = new Map<string, ChargeResult>();
  private readonly refundsByIdempotencyKey = new Map<string, RefundResult>();

  constructor(
    private readonly webhookSecret = 'mock-webhook-secret',
    private readonly script: MockPaymentScript = {},
  ) {}

  async createCharge(request: CreateChargeRequest): Promise<ChargeResult> {
    const existing = this.chargesByIdempotencyKey.get(request.idempotencyKey);
    if (existing) return existing;

    const outcome = this.script.nextOutcome ?? 'SUCCEEDED';
    const fee = Money.fromMinor(
      (request.amount.minor * MOCK_FEE_PERCENT) / 1000n + MOCK_FEE_FIXED_MINOR,
      request.amount.currency,
    );

    const result: ChargeResult = {
      providerRef: `mockpi_${request.idempotencyKey.slice(0, 16)}`,
      status: outcome,
      hostedUrl: `/checkout/mock-payment?ref=mockpi_${request.idempotencyKey.slice(0, 16)}`,
      fee: outcome === 'SUCCEEDED' ? fee : Money.zero(request.amount.currency),
      net: outcome === 'SUCCEEDED' ? request.amount.minus(fee) : Money.zero(request.amount.currency),
      failureReason:
        outcome === 'FAILED' ? (this.script.failureReason ?? 'Mock card declined') : null,
    };

    this.chargesByIdempotencyKey.set(request.idempotencyKey, result);
    this.charges.set(result.providerRef, result);
    return result;
  }

  async getCharge(providerRef: string): Promise<ChargeResult> {
    const charge = this.charges.get(providerRef);
    if (!charge) {
      // Unknown to the provider. Reported as UNKNOWN, not FAILED: a charge we
      // cannot find might still exist on their side.
      return {
        providerRef,
        status: 'UNKNOWN',
        hostedUrl: null,
        fee: Money.zero(),
        net: Money.zero(),
        failureReason: 'Charge not found at the provider',
      };
    }
    return charge;
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    const existing = this.refundsByIdempotencyKey.get(request.idempotencyKey);
    if (existing) return existing;

    const charge = this.charges.get(request.paymentProviderRef);
    const result: RefundResult =
      charge && charge.status === 'SUCCEEDED'
        ? { providerRef: `mockre_${request.idempotencyKey.slice(0, 16)}`, status: 'SUCCEEDED', failureReason: null }
        : {
            providerRef: `mockre_${request.idempotencyKey.slice(0, 16)}`,
            status: 'FAILED',
            failureReason: 'Original charge is not in a refundable state',
          };

    this.refundsByIdempotencyKey.set(request.idempotencyKey, result);
    return result;
  }

  verifyWebhook(rawBody: string, headers: Record<string, string>): WebhookVerification {
    const provided = headers['x-mock-signature'] ?? headers['X-Mock-Signature'];
    if (!provided) {
      return { valid: false, externalId: null, eventType: null, reason: 'Missing signature header' };
    }

    const expected = this.signWebhook(rawBody);
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    // Constant-time compare, and length-check first because timingSafeEqual
    // throws on a length mismatch.
    const valid = a.length === b.length && timingSafeEqual(a, b);
    if (!valid) {
      return { valid: false, externalId: null, eventType: null, reason: 'Signature mismatch' };
    }

    try {
      const parsed = JSON.parse(rawBody) as { id?: string; type?: string };
      if (!parsed.id || !parsed.type) {
        return { valid: false, externalId: null, eventType: null, reason: 'Missing id or type' };
      }
      return { valid: true, externalId: parsed.id, eventType: parsed.type, reason: null };
    } catch {
      return { valid: false, externalId: null, eventType: null, reason: 'Malformed JSON body' };
    }
  }

  /** Test/seed helper for producing correctly signed webhook payloads. */
  signWebhook(rawBody: string): string {
    return createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
  }

  /** Test helper: simulate the provider settling a previously unknown charge. */
  settleCharge(providerRef: string, status: 'SUCCEEDED' | 'FAILED'): void {
    const charge = this.charges.get(providerRef);
    if (!charge) return;
    this.charges.set(providerRef, { ...charge, status });
  }
}
