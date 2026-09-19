import type { Metadata } from 'next';
import { getConfig } from '@/server/config';
import { Chip, SpecTable } from '@/components/system';

export const metadata: Metadata = { title: 'Support' };

/**
 * Support.
 *
 * Contact method and response expectation, nothing else.
 *
 * There is no response target here because the owner has not set one, and an
 * invented "we reply within 24 hours" would be a commitment nobody made. It is
 * marked unset the same way every other undecided term on this site is marked,
 * rather than quietly omitted — a missing SLA that looks like an oversight is
 * worse than one that says it is missing.
 */
export default function ContactPage() {
  const config = getConfig();

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 space-y-6">
      <h1 className="text-3xl">Support</h1>

      <SpecTable
        caption="How to reach support and what to expect"
        columns={[
          { key: 'item', label: 'Item' },
          { key: 'value', label: 'Detail' },
        ]}
        rows={[
          {
            item: 'Email',
            value: (
              <a
                href={`mailto:${config.company.supportEmail}`}
                className="no-caps text-accent hover:underline"
              >
                {config.company.supportEmail}
              </a>
            ),
          },
          {
            item: 'Response time',
            value: (
              <span className="flex flex-wrap items-center gap-2">
                <Chip status="UNRESOLVED">Not yet set</Chip>
              </span>
            ),
          },
          { item: 'Cost', value: <span className="no-caps">Included with every account</span> },
          {
            item: 'Postal address',
            value: <span className="no-caps">{config.company.postalAddress}</span>,
          },
        ]}
      />

      {config.company.incomplete && (
        <div className="rounded-xl border border-border-strong bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="no-caps text-sm font-bold">Contact details are placeholders</p>
            <Chip status="UNRESOLVED" />
          </div>
          <p className="no-caps mt-2 text-sm text-fg-muted leading-relaxed">
            The company name, legal entity, jurisdiction, postal address and support email have not
            been supplied yet. They must be completed before this site is used with real customers.
          </p>
        </div>
      )}
    </div>
  );
}
