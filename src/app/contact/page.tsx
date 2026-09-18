import type { Metadata } from 'next';
import { getConfig } from '@/server/config';
import { Callout, Card } from '@/components/ui';

export const metadata: Metadata = { title: 'Support' };

export default function ContactPage() {
  const config = getConfig();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Support</h1>
        <p className="mt-3 text-fg-muted">
          Support is included with every account. You never need to buy anything to get help with
          your account, your rules or a payout.
        </p>
      </header>

      <Card className="p-6">
        <h2 className="font-semibold">Contact us</h2>
        <p className="mt-2 text-fg-muted">
          Email{' '}
          <a href={`mailto:${config.company.supportEmail}`} className="text-accent hover:underline">
            {config.company.supportEmail}
          </a>
        </p>
        <p className="mt-2 text-sm text-fg-subtle">{config.company.postalAddress}</p>
      </Card>

      {config.company.incomplete && (
        <Callout tone="warn" title="Contact details are placeholders">
          The company name, legal entity, jurisdiction, postal address and support email above have
          not been supplied yet. They are placeholders and must be completed before this site is
          used with real customers.
        </Callout>
      )}

      <Card className="p-6">
        <h2 className="font-semibold">If you are signed in</h2>
        <p className="mt-2 text-fg-muted text-sm leading-relaxed">
          Your dashboard shows your account status, the reason for any pause or breach with the
          supporting account data, your payout history, and every document you have signed. Having
          that open when you contact us usually resolves things faster.
        </p>
      </Card>
    </div>
  );
}
