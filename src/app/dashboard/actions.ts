'use server';

/**
 * Trader dashboard server actions.
 */

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/server/auth/session';
import { PayoutError, requestPayout } from '@/server/services/payout-service';
import { Money } from '@/domain/money/money';
import { MINIMUM_GROSS_WITHDRAWAL } from '@/domain/catalog/plans';

export interface PayoutActionState {
  readonly error: string | null;
  readonly success: string | null;
}

export async function submitPayoutRequest(
  _previous: PayoutActionState,
  formData: FormData,
): Promise<PayoutActionState> {
  const user = await requireUser();

  const tradingAccountId = String(formData.get('tradingAccountId') ?? '');
  const grossRaw = String(formData.get('gross') ?? '').trim();

  if (!tradingAccountId) return { error: 'Choose an account.', success: null };

  let gross: Money;
  try {
    gross = Money.parse(grossRaw);
  } catch {
    return {
      error: `Enter a whole-dollar amount of at least ${MINIMUM_GROSS_WITHDRAWAL.value.format()}.`,
      success: null,
    };
  }

  try {
    // The idempotency key is per submission, so a double-click cannot create
    // two requests that each reserve capacity.
    const result = await requestPayout({
      userId: user.id,
      tradingAccountId,
      gross,
      idempotencyKey: String(formData.get('idempotencyKey') ?? '') || randomUUID(),
    });

    revalidatePath('/dashboard');
    return {
      error: null,
      success: result.created
        ? `Requested ${gross.format()} gross, paying ${gross.halfExact().format()} in cash. ` +
          'Your daily capacity is reserved now, not when the payment settles.'
        : 'That request was already submitted.',
    };
  } catch (error) {
    if (error instanceof PayoutError) return { error: error.message, success: null };
    throw error;
  }
}
