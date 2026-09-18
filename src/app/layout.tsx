import type { Metadata } from 'next';
import './globals.css';
import { getConfig } from '@/server/config';
import { DemoBanner } from '@/components/DemoBanner';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { getCurrentUser } from '@/server/auth/session';

export const metadata: Metadata = {
  title: 'Simulated Futures Accounts',
  description:
    'Purchase access to a simulated futures account with no evaluation phase, ' +
    'no consistency rule and same-day payout eligibility.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const config = getConfig();
  const user = await getCurrentUser().catch(() => null);

  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-surface-raised focus:px-4 focus:py-2 focus:rounded-md focus:border focus:border-accent"
        >
          Skip to content
        </a>
        {config.isDemo && <DemoBanner />}
        <SiteHeader user={user} />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter company={config.company} />
      </body>
    </html>
  );
}
