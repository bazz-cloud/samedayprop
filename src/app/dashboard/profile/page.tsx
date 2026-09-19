import type { Metadata } from 'next';
import { prisma } from '@/server/db';
import { requireUser } from '@/server/auth/session';
import { Callout, Card } from '@/components/ui';
import { countryOptions } from '@/domain/customer/countries';
import { checkPayoutProfile } from '@/domain/customer/profile';
import { ProfileForm } from './ProfileForm';

export const metadata: Metadata = { title: 'Your details' };

export default async function ProfilePage() {
  const user = await requireUser();
  const profile = await prisma.customerProfile.findUnique({ where: { userId: user.id } });

  const current = {
    phone: profile?.phone ?? null,
    addressLine1: profile?.addressLine1 ?? null,
    addressLine2: profile?.addressLine2 ?? null,
    city: profile?.city ?? null,
    region: profile?.region ?? null,
    postalCode: profile?.postalCode ?? null,
    countryCode: profile?.countryCode ?? user.countryCode ?? null,
  };
  const check = checkPayoutProfile(current);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Your details</h1>
        <p className="mt-2 text-fg-muted">
          We need these before your first payout, not before you buy an account. Nothing here
          affects your trading.
        </p>
      </header>

      <Card>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Account</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-fg-subtle">Name</dt>
            <dd className="font-medium">{user.legalName ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-fg-subtle">Email</dt>
            <dd className="font-medium">{user.email}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-fg-subtle">
          Your legal name is the one you sign agreements with. Contact support to change it — we
          cannot change a name on an agreement that has already been signed.
        </p>
      </Card>

      {check.ok ? (
        <Callout tone="accent">
          Your details are complete. You can request a payout as soon as an account qualifies.
        </Callout>
      ) : (
        <Callout tone="warn">
          Complete these before your first payout request. {check.messages.join(' ')}
        </Callout>
      )}

      <ProfileForm current={current} countries={countryOptions()} />
    </div>
  );
}
