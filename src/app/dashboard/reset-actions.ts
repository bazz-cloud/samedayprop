'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db';
import { requireUser } from '@/server/auth/session';
import { getConfig } from '@/server/config';
import { ResetError, applyReset, getResetOffer } from '@/server/services/reset-service';
import { getPaymentProvider } from '@/server/providers/registry';
import { Money } from '@/domain/money/money';

export interface ResetActionState {
  readonly error: string | null;
  readonly success: string | null;
}

/**
 * Buy and apply a reset.
 *
 * The charge is taken before the account is restored, and the restore is
 * idempotent on the order, so a retry after a timeout cannot reset twice or
 * charge twice.
 */
export async function purchaseReset(
  _previous: ResetActionState,
  formData: FormData,
): Promise<ResetActionState> {
  const user = await requireUser();
  const config = getConfig();
  const tradingAccountId = String(formData.get('tradingAccountId') ?? '');
  const idempotencyKey = String(formData.get('idempotencyKey') ?? '') || randomUUID();

  const offer = await getResetOffer(user.id, tradingAccountId);
  if (!offer) return { error: 'That account was not found.', success: null };
  if (!offer.allowed) return { error: offer.reason ?? 'This account cannot be reset.', success: null };

  const account = await prisma.tradingAccount.findUniqueOrThrow({
    where: { id: tradingAccountId },
    select: { planVersionId: true, orderId: true },
  });

  try {
    const existing = await prisma.order.findUnique({ where: { idempotencyKey } });
    const order =
      existing ??
      (await prisma.order.create({
        data: {
          userId: user.id,
          quoteId: (await prisma.order.findUniqueOrThrow({
            where: { id: account.orderId },
            select: { quoteId: true },
          })).quoteId,
          planVersionId: account.planVersionId,
          status: 'PENDING_PAYMENT',
          subtotalMinor: offer.price.minor,
          discountMinor: 0n,
          taxMinor: 0n,
          totalMinor: offer.price.minor,
          termsSnapshot: JSON.stringify({
            kind: 'ACCOUNT_RESET',
            tradingAccountId,
            planKey: offer.planKey,
            price: offer.price.toDecimalString(),
            newAccountPrice: offer.newAccountPrice.toDecimalString(),
          }),
          termsHash: `reset:${tradingAccountId}`,
          idempotencyKey,
          items: {
            create: [
              {
                kind: 'ACCOUNT_RESET',
                itemKey: offer.planKey,
                targetTradingAccountId: tradingAccountId,
                name: `${offer.planLabel} account reset`,
                quantity: 1,
                unitListPriceMinor: offer.price.minor,
                lineSubtotalMinor: offer.price.minor,
                lineDiscountMinor: 0n,
                lineTotalMinor: offer.price.minor,
              },
            ],
          },
        },
      }));

    const payments = getPaymentProvider();
    const charge = await payments.createCharge({
      orderId: order.id,
      userId: user.id,
      amount: Money.fromMinor(order.totalMinor),
      description: `${offer.planLabel} account reset (${config.mode})`,
      idempotencyKey: `charge:${order.id}`,
      returnUrl: `${config.baseUrl}/dashboard`,
    });

    if (charge.status !== 'SUCCEEDED') {
      return {
        error: charge.failureReason ?? 'That payment did not complete. The account is unchanged.',
        success: null,
      };
    }

    await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID' } });
    const result = await applyReset({ userId: user.id, tradingAccountId, orderId: order.id });

    revalidatePath('/dashboard');
    return {
      error: null,
      success: result.applied
        ? `${result.detail} Your payout history and any lifetime payout capacity you have already used are unchanged.`
        : result.detail,
    };
  } catch (error) {
    if (error instanceof ResetError) return { error: error.message, success: null };
    throw error;
  }
}
