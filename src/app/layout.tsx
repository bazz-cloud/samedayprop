import type { Metadata } from 'next';
import './globals.css';
import { getConfig } from '@/server/config';
import { DemoBanner } from '@/components/DemoBanner';
import { SiteHeader } from '@/components/SiteHeader';
import { ValueBar } from '@/components/ValueBar';
import { PromoTicker } from '@/components/PromoTicker';
import { CredentialsBanner } from '@/components/CredentialsBanner';
import { prisma } from '@/server/db';
import { getCredentialForUser } from '@/server/services/credential-service';
import { SiteFooter } from '@/components/SiteFooter';
import { getCurrentUser } from '@/server/auth/session';

export const metadata: Metadata = {
  title: {
    default: 'Bull Rush Futures',
    template: '%s | Bull Rush Futures',
  },
  description:
    'Purchase access to a simulated futures account with no evaluation phase, ' +
    'no consistency rule and same-day payout eligibility.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const config = getConfig();
  const user = await getCurrentUser().catch(() => null);

  // The credentials banner appears only once an account exists and is
  // tradeable — there is nothing to sign in to before that.
  let credential = null;
  if (user) {
    const account = await prisma.tradingAccount
      .findFirst({
        where: { userId: user.id, tradingStatus: { in: ['ACTIVE', 'DAILY_PAUSED'] } },
        orderBy: { createdAt: 'desc' },
        include: { planVersion: { select: { label: true } } },
      })
      .catch(() => null);

    if (account) {
      const view = await getCredentialForUser(user.id, account.id).catch(() => null);
      if (view) {
        credential = {
          tradingAccountId: account.id,
          accountLabel: account.planVersion.label,
          username: view.username,
          password: view.password,
          acknowledged: view.acknowledged,
          mustChangeOnFirstUse: view.mustChangeOnFirstUse,
          isDemo: config.isDemo,
        };
      }
    }
  }

  return (
    <html lang="en">
      <head>
        {/*
          Satoshi, from the foundry's own CDN.
          Preconnect first so the font request does not wait on a fresh TLS
          handshake; `display=swap` means text paints in the fallback
          immediately rather than sitting invisible while the font arrives.
          Weights: 400 for body, 500 for the few medium labels, 700 for every
          heading, subheading and table title. 401 and 701 are Fontshare's
          numbering for the italics of those weights, needed by the wordmark.
        */}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f%5B%5D=satoshi@400,401,500,700,701&display=swap"
        />
      </head>
      <body className="min-h-screen flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-surface-raised focus:px-4 focus:py-2 focus:rounded-md focus:border focus:border-accent"
        >
          Skip to content
        </a>
        {config.isDemo && <DemoBanner />}
        <SiteHeader user={user} />
        {/* Kept on checkout too, unlike the value bar: the code has to be
            readable on the page where it gets typed in. */}
        <PromoTicker />
        <ValueBar />
        {credential && <CredentialsBanner data={credential} />}
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter company={config.company} />
      </body>
    </html>
  );
}
