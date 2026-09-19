'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireUser } from '@/server/auth/session';
import { recordAudit } from '@/server/services/audit-service';
import { checkPayoutProfile } from '@/domain/customer/profile';
import { isKnownCountryCode } from '@/domain/customer/countries';

export interface ProfileActionState {
  readonly error: string | null;
  readonly success: string | null;
}

const ProfileSchema = z.object({
  phone: z.string().trim().max(40),
  addressLine1: z.string().trim().max(200),
  addressLine2: z.string().trim().max(200),
  city: z.string().trim().max(120),
  region: z.string().trim().max(120),
  postalCode: z.string().trim().max(40),
  countryCode: z.string().trim().length(2).refine(isKnownCountryCode, 'Unrecognised country'),
});

/**
 * Save the payout profile.
 *
 * `completedAt` is stamped the first time the record satisfies
 * checkPayoutProfile and is never cleared afterwards: it records when we first
 * held enough to pay this person, which is an audit fact about the past. If a
 * later edit leaves the profile incomplete, the payout gate reads the fields
 * themselves rather than this timestamp, so an incomplete profile still blocks.
 */
export async function saveProfile(
  _previous: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requireUser();

  const parsed = ProfileSchema.safeParse({
    phone: formData.get('phone') ?? '',
    addressLine1: formData.get('addressLine1') ?? '',
    addressLine2: formData.get('addressLine2') ?? '',
    city: formData.get('city') ?? '',
    region: formData.get('region') ?? '',
    postalCode: formData.get('postalCode') ?? '',
    countryCode: formData.get('countryCode') ?? '',
  });

  if (!parsed.success) {
    return { error: 'Please check the details you entered.', success: null };
  }

  const blank = (v: string) => (v.length === 0 ? null : v);
  const data = {
    phone: blank(parsed.data.phone),
    addressLine1: blank(parsed.data.addressLine1),
    addressLine2: blank(parsed.data.addressLine2),
    city: blank(parsed.data.city),
    region: blank(parsed.data.region),
    postalCode: blank(parsed.data.postalCode),
    countryCode: parsed.data.countryCode.toUpperCase(),
  };

  const existing = await prisma.customerProfile.findUnique({ where: { userId: user.id } });
  const check = checkPayoutProfile(data);
  const completedAt = existing?.completedAt ?? (check.ok ? new Date() : null);

  await prisma.customerProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data, completedAt },
    update: { ...data, completedAt },
  });

  // The audit trail records THAT the profile changed and whether it is now
  // sufficient. It deliberately carries no address, phone number or name: an
  // audit log is read far more widely than the record it describes.
  await recordAudit({
    actorId: user.id,
    actorLabel: 'Customer',
    action: 'CUSTOMER_PROFILE_UPDATED',
    entityType: 'CustomerProfile',
    entityId: user.id,
    reason: check.ok ? 'Payout profile complete' : 'Payout profile still incomplete',
  });

  revalidatePath('/dashboard/profile');
  revalidatePath('/dashboard');

  return check.ok
    ? { error: null, success: 'Saved. Your details are complete.' }
    : { error: null, success: `Saved. Still needed: ${check.messages.join(' ')}` };
}
