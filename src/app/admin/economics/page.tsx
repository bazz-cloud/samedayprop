import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { ForbiddenError, UnauthorizedError, requireRole } from '@/server/auth/session';
import { SensitivityCalculator } from '@/components/SensitivityCalculator';
import { Callout } from '@/components/ui';

export const metadata: Metadata = { title: 'Economics' };
export const dynamic = 'force-dynamic';

export default async function EconomicsPage() {
  try {
    await requireRole('OWNER', 'FINANCE');
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect('/login?next=%2Fadmin%2Feconomics');
    if (error instanceof ForbiddenError) {
      return (
        <div className="mx-auto max-w-2xl px-4 py-16">
          <Callout tone="danger" title="Access denied">
            {error.message}
          </Callout>
        </div>
      );
    }
    throw error;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
      <header>
        <Link href="/admin" className="text-sm text-accent hover:underline">
          &larr; Operations
        </Link>
        <h1 className="text-2xl font-bold tracking-tight mt-2">Sensitivity calculator</h1>
        <p className="text-sm text-fg-muted mt-2 max-w-3xl leading-relaxed">
          The reference scenario below reproduces the planning math for the $50,000 account: $599
          list becomes $449.25 after the coupon, and with $120 of lifetime variable costs, a 30%
          payout probability and a $1,000 conditional average payout, contribution is $29.25 per
          sale before fixed overhead. At 33.3% it is &minus;$3.75.
        </p>
      </header>

      <SensitivityCalculator />
    </div>
  );
}
