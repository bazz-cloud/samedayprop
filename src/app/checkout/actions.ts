'use server';

/**
 * Checkout server actions.
 *
 * Next.js server actions carry an origin check, which covers CSRF for these
 * POSTs. Everything else is re-derived here: the caller supplies a quote id and
 * a typed name, never a price.
 */

import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/server/db';
import { requireUser } from '@/server/auth/session';
import {
  CheckoutError,
  createOrder,
  markOrderPaid,
  recordAcceptance,
  requiredDocuments,
  revalidateQuote,
  signatureStatus,
} from '@/server/services/checkout-service';
import { getPaymentProvider } from '@/server/providers/registry';
import { Money } from '@/domain/money/money';
import { getConfig } from '@/server/config';
import { CONSENT_WORDING } from './consent';

export interface CheckoutActionState {
  readonly error: string | null;
  readonly fieldErrors: Record<string, string>;
}

export async function completeCheckout(
  _previous: CheckoutActionState,
  formData: FormData,
): Promise<CheckoutActionState> {
  const user = await requireUser();
  const config = getConfig();

  const quoteId = String(formData.get('quoteId') ?? '');
  const typedLegalName = String(formData.get('typedLegalName') ?? '').trim();
  const idempotencyKey = String(formData.get('idempotencyKey') ?? '') || randomUUID();

  if (!quoteId) return { error: 'That checkout session is missing.', fieldErrors: {} };

  const documents = await requiredDocuments();

  // One unchecked-by-default acknowledgement covering every document, because
  // they are presented as one PDF with one signature block. The per-document
  // evidence is unchanged: an acceptance row is still written for each one
  // below, carrying that document's own version and body hash.
  if (formData.get('agreedToAll') !== 'on') {
    return {
      error: 'Please agree to the terms before signing.',
      fieldErrors: {
        agreedToAll: 'Tick this to confirm you have read and agree to the documents.',
      },
    };
  }

  if (documents.length === 0) {
    // Recording a signature against nothing would produce an acceptance that
    // proves agreement to no terms at all.
    return {
      error: 'No agreements are published, so there is nothing to sign yet.',
      fieldErrors: {},
    };
  }

  if (typedLegalName.length < 2) {
    return {
      error: 'Type your full legal name to sign.',
      fieldErrors: { typedLegalName: 'Type your full legal name exactly as it appears above.' },
    };
  }

  // Confirm the terms have not moved since the customer reviewed them BEFORE
  // recording any signature against them.
  const revalidated = await revalidateQuote(quoteId);
  if (!revalidated.ok) {
    return { error: revalidated.reason ?? 'That quote is no longer valid.', fieldErrors: {} };
  }

  const headerList = await headers();
  const ipAddress =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headerList.get('x-real-ip') ?? undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  for (const document of documents) {
    await recordAcceptance({
      userId: user.id,
      quoteId,
      documentId: document.id,
      typedLegalName,
      consentWording: CONSENT_WORDING,
      ipAddress,
      userAgent,
    });
  }

  const signatures = await signatureStatus(user.id, quoteId);
  if (!signatures.complete) {
    return { error: 'Some agreements are still outstanding.', fieldErrors: {} };
  }

  let orderId: string;
  try {
    const order = await createOrder({ userId: user.id, quoteId, idempotencyKey });
    orderId = order.orderId;
  } catch (error) {
    if (error instanceof CheckoutError) return { error: error.message, fieldErrors: {} };
    throw error;
  }

  // ---- payment ------------------------------------------------------------
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const payments = getPaymentProvider();

  const charge = await payments.createCharge({
    orderId,
    userId: user.id,
    amount: Money.fromMinor(order.totalMinor),
    description: `Simulated futures account purchase (${config.mode})`,
    idempotencyKey: `charge:${orderId}`,
    returnUrl: `${config.baseUrl}/checkout/status?order=${orderId}`,
  });

  if (charge.status === 'SUCCEEDED') {
    await markOrderPaid({
      orderId,
      provider: payments.name,
      providerRef: charge.providerRef,
      amount: Money.fromMinor(order.totalMinor),
      fee: charge.fee,
      net: charge.net,
      idempotencyKey: `payment:${orderId}`,
    });
  } else if (charge.status === 'FAILED') {
    await prisma.payment.upsert({
      where: { provider_providerRef: { provider: payments.name, providerRef: charge.providerRef } },
      update: { status: 'FAILED', failureReason: charge.failureReason },
      create: {
        orderId,
        provider: payments.name,
        providerMode: config.mode === 'PRODUCTION' ? 'PRODUCTION' : 'DEMO',
        providerRef: charge.providerRef,
        status: 'FAILED',
        amountMinor: order.totalMinor,
        failureReason: charge.failureReason,
        idempotencyKey: `payment:${orderId}`,
      },
    });
    return { error: charge.failureReason ?? 'That payment was declined.', fieldErrors: {} };
  } else {
    // PENDING / UNKNOWN / REQUIRES_ACTION: recorded truthfully, never assumed paid.
    await prisma.payment.upsert({
      where: { provider_providerRef: { provider: payments.name, providerRef: charge.providerRef } },
      update: { status: charge.status },
      create: {
        orderId,
        provider: payments.name,
        providerMode: config.mode === 'PRODUCTION' ? 'PRODUCTION' : 'DEMO',
        providerRef: charge.providerRef,
        status: charge.status,
        amountMinor: order.totalMinor,
        idempotencyKey: `payment:${orderId}`,
      },
    });
  }

  redirect(`/checkout/status?order=${orderId}`);
}
