import Link from 'next/link';
import type { CompanyPlaceholders } from '@/server/config';

/**
 * Footer disclosures.
 *
 * Covers simulated trading, nominal balances versus cash, fee and breach risk,
 * the absence of any guarantee, and links to the current policies. It describes
 * the business accurately: no claim of regulatory approval, and no suggestion
 * that simulation removes regulatory obligations.
 */
export function SiteFooter({ company }: { company: CompanyPlaceholders }) {
  return (
    <footer className="border-t border-border bg-surface mt-16">
      <div className="mx-auto max-w-7xl px-4 py-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div>
          <p className="font-semibold">{company.name}</p>
          <p className="text-fg-subtle mt-1">{company.legalEntity}</p>
          <p className="text-fg-subtle">{company.jurisdiction}</p>
          <p className="text-fg-subtle mt-2">{company.postalAddress}</p>
          <a href={`mailto:${company.supportEmail}`} className="text-accent hover:underline mt-2 inline-block">
            {company.supportEmail}
          </a>
          {company.incomplete && (
            <p className="mt-3 text-warn text-xs border border-warn/30 bg-warn-dim/40 rounded p-2">
              Company details are placeholders. Legal documents cannot be finalised until the
              owner supplies the entity name, jurisdiction and contact details.
            </p>
          )}
        </div>

        {/*
          Three link groups, the grouping this category converges on: the
          product, the company, and the policies. Each is its own column so the
          headings share a baseline at every width.
        */}
        <nav aria-label="Program">
          <h2 className="font-semibold mb-2">Program</h2>
          <ul className="space-y-1 text-fg-muted">
            <li><Link href="/accounts" className="hover:text-fg">Accounts</Link></li>
            <li><Link href="/rules" className="hover:text-fg">Rules</Link></li>
            <li><Link href="/payouts" className="hover:text-fg">Payouts</Link></li>
            <li><Link href="/platform" className="hover:text-fg">Platform</Link></li>
            <li><Link href="/faq" className="hover:text-fg">FAQ</Link></li>
          </ul>
        </nav>

        <nav aria-label="Company">
          <h2 className="font-semibold mb-2">Company</h2>
          <ul className="space-y-1 text-fg-muted">
            <li><Link href="/about" className="hover:text-fg">About</Link></li>
            <li><Link href="/contact" className="hover:text-fg">Support</Link></li>
            <li><Link href="/login" className="hover:text-fg">Sign in</Link></li>
          </ul>
        </nav>

        <nav aria-label="Policies">
          <h2 className="font-semibold mb-2">Policies</h2>
          <ul className="space-y-1 text-fg-muted">
            <li><Link href="/legal/trader-agreement" className="hover:text-fg">Trader agreement</Link></li>
            <li><Link href="/legal/simulation-and-reward-disclosure" className="hover:text-fg">Simulation &amp; reward disclosure</Link></li>
            <li><Link href="/legal/payout-policy" className="hover:text-fg">Payout policy</Link></li>
            <li><Link href="/legal/purchase-and-refund-terms" className="hover:text-fg">Purchase &amp; refund terms</Link></li>
            <li><Link href="/legal/prohibited-conduct" className="hover:text-fg">Prohibited conduct</Link></li>
            <li><Link href="/legal/privacy-and-data" className="hover:text-fg">Privacy</Link></li>
          </ul>
        </nav>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-fg-subtle space-y-3 leading-relaxed">
          <h2 className="font-semibold text-fg">Important disclosures</h2>
          <div className="grid gap-x-10 gap-y-3 md:grid-cols-2">
            <p>
              <strong className="text-fg-muted">All trading in this program is simulated.</strong>{' '}
              Orders do not reach a live exchange. Simulated results do not represent live trading
              and cannot reflect every real-world factor, including liquidity, slippage and
              execution during fast markets.
            </p>
            <p>
              <strong className="text-fg-muted">Account sizes are nominal figures, not cash.</strong>{' '}
              A &ldquo;$50,000 account&rdquo; does not mean $50,000 is held for you, and the
              simulated balance cannot be withdrawn. What can be earned is a cash reward calculated
              against simulated profits: a $500 gross withdrawal reduces the simulated account by
              $500 and pays $250 in real cash.
            </p>
            <p>
              <strong className="text-fg-muted">You can lose the fee you pay and receive nothing.</strong>{' '}
              Accounts can breach a daily loss limit or a trailing drawdown threshold, which pauses
              or ends access. Most participants in programs of this kind do not receive a payout.
            </p>
            <p>
              No profit, reward or payout is guaranteed. Payout eligibility is determined by the
              published rules; the timing of any payment depends on payment rails, identity
              verification status and banking cut-off times. We do not guarantee same-day receipt
              of funds.
            </p>
            <p className="md:col-span-2">
              Nothing here is financial, investment, legal or tax advice. This program is not a
              brokerage account and no regulatory approval or registration is claimed. Operating a
              simulated program does not remove any obligation that may apply under the law of a
              given jurisdiction.
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-border px-4 py-4 text-center text-xs text-fg-subtle">
        &copy; {new Date().getFullYear()} {company.name}. All figures shown on this site are
        subject to the policies linked above.
      </div>
    </footer>
  );
}
