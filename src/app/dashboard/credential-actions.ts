'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/server/auth/session';
import { acknowledgeCredential, reissueCredential } from '@/server/services/credential-service';

export interface CredentialActionState {
  readonly error: string | null;
  /** A freshly issued password, shown once and never read back from storage. */
  readonly newPassword: string | null;
}

export async function saveCredentialAcknowledgement(
  _previous: CredentialActionState,
  formData: FormData,
): Promise<CredentialActionState> {
  const user = await requireUser();
  const tradingAccountId = String(formData.get('tradingAccountId') ?? '');
  const result = await acknowledgeCredential(user.id, tradingAccountId);
  if (!result.ok) return { error: 'That account was not found.', newPassword: null };
  revalidatePath('/dashboard');
  return { error: null, newPassword: null };
}

export async function requestCredentialReissue(
  _previous: CredentialActionState,
  formData: FormData,
): Promise<CredentialActionState> {
  const user = await requireUser();
  const tradingAccountId = String(formData.get('tradingAccountId') ?? '');
  const issued = await reissueCredential(user.id, tradingAccountId);
  if (!issued) return { error: 'That account was not found.', newPassword: null };
  revalidatePath('/dashboard');
  return { error: null, newPassword: issued.password };
}
