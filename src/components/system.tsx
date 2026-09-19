/**
 * The shared component set.
 *
 * Six components that every page reuses, so the site has one answer to each
 * presentation problem rather than eight. Defined once here; pages compose
 * these rather than inventing their own layout.
 *
 * Status is carried by FILL, never by hue — there is no amber, no red and no
 * blue in this system. A status that must stand out inverts to white or drops
 * its fill. That also means status survives being printed, and survives a
 * colour-blind reader.
 */

import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

export type Status = 'CONFIRMED' | 'PROPOSED' | 'UNRESOLVED' | 'EXTERNAL' | 'STOP';

const CHIP: Record<Status, { className: string; label: string }> = {
  CONFIRMED: { className: 'bg-accent text-bg border-accent', label: 'Confirmed' },
  PROPOSED: { className: 'bg-transparent text-accent border-accent', label: 'Proposed' },
  UNRESOLVED: { className: 'bg-transparent text-fg-muted border-fg-muted', label: 'Not decided' },
  EXTERNAL: { className: 'bg-transparent text-fg-muted border-border-strong', label: 'External' },
  STOP: { className: 'bg-fg text-bg border-fg', label: 'Stop' },
};

export function Chip({ status, children }: { status: Status; children?: ReactNode }) {
  const chip = CHIP[status];
  return (
    <span
      className={`no-caps inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${chip.className}`}
    >
      {children ?? chip.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 1 · Rule card
// ---------------------------------------------------------------------------

/**
 * A bold one-line answer, an optional status, and detail that stays collapsed.
 *
 * The answer must stand alone. If someone reads only the bold line they have
 * the rule; the detail explains it but never completes it.
 */
export function RuleCard({
  answer,
  status,
  detailLabel = 'How this works',
  children,
}: {
  answer: string;
  status?: Status;
  detailLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="no-caps font-bold text-base leading-snug">{answer}</p>
        {status && <Chip status={status} />}
      </div>
      {children && (
        <details className="mt-3 group">
          <summary className="no-caps cursor-pointer list-none text-sm text-fg-muted hover:text-accent">
            <span className="inline-block transition-transform group-open:rotate-90">▸</span>{' '}
            {detailLabel}
          </summary>
          <div className="mt-2 text-sm text-fg-muted leading-relaxed space-y-2">{children}</div>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2 · Accordion
// ---------------------------------------------------------------------------

/**
 * Closed by default. Closed shows the title, the status and the one-line rule,
 * which is enough to answer the question without opening anything.
 */
export function Accordion({
  title,
  rule,
  status,
  children,
}: {
  title: string;
  rule: string;
  status?: Status;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-border bg-surface">
      <summary className="cursor-pointer list-none p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden="true" className="text-fg-subtle transition-transform group-open:rotate-90">
            ▸
          </span>
          <h3 className="text-sm font-bold">{title}</h3>
          {status && <Chip status={status} />}
        </div>
        <p className="no-caps mt-1.5 pl-5 text-sm text-fg-muted">{rule}</p>
      </summary>
      <div className="px-4 pb-4 pl-9 text-sm text-fg-muted leading-relaxed">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// 3 · Spec table
// ---------------------------------------------------------------------------

export interface SpecColumn {
  readonly key: string;
  readonly label: string;
  /** Numbers right-align. Labels do not. */
  readonly numeric?: boolean;
}

/**
 * Every number on the site lives in one of these.
 *
 * Nothing in a spec table is repeated in prose beside it — that is the rule the
 * table exists to enforce.
 */
export function SpecTable({
  columns,
  rows,
  caption,
}: {
  columns: readonly SpecColumn[];
  rows: readonly Record<string, ReactNode>[];
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-border bg-surface">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`px-3 py-2.5 text-xs font-bold tracking-wide text-fg-muted ${
                  column.numeric ? 'text-right' : 'text-left'
                }`}
              >
                {column.label.toUpperCase()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row[columns[0]!.key])} className={index > 0 ? 'border-t border-border' : ''}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-3 py-2.5 ${column.numeric ? 'text-right tnum' : 'font-medium'}`}
                >
                  {row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4 · Formula card
// ---------------------------------------------------------------------------

export function FormulaCard({
  formula,
  variables,
  caption,
}: {
  formula: string;
  variables: readonly { readonly symbol: string; readonly meaning: string }[];
  caption?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <p className="font-mono text-base sm:text-lg px-4 py-4 border-b border-border text-accent">
        {formula}
      </p>
      <dl className="divide-y divide-border text-sm">
        {variables.map((variable) => (
          <div key={variable.symbol} className="flex gap-4 px-4 py-2">
            <dt className="font-mono text-accent w-8 shrink-0">{variable.symbol}</dt>
            <dd className="no-caps text-fg-muted">{variable.meaning}</dd>
          </div>
        ))}
      </dl>
      {caption && <p className="no-caps px-4 py-2 text-xs text-fg-subtle border-t border-border">{caption}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5 · Stat pair
// ---------------------------------------------------------------------------

/**
 * Icon plus a label of about three words. No sentence underneath — if the label
 * needs explaining, it is the wrong label.
 */
export function StatPair({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5">
      <span aria-hidden="true" className="text-accent text-lg leading-none shrink-0">
        {icon}
      </span>
      <span className="text-sm font-bold tracking-wide">{label.toUpperCase()}</span>
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

// ---------------------------------------------------------------------------
// 6 · Disclosure block
// ---------------------------------------------------------------------------

/**
 * Full legal copy, never compressed.
 *
 * Wider leading and no truncation. Nothing in here is summarised, shortened or
 * replaced by a plain-language gloss — a summary may sit ABOVE a clause, but it
 * never stands in for one.
 */
export function DisclosureBlock({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border-strong bg-surface p-5">
      {title && <h3 className="text-sm font-bold mb-3">{title}</h3>}
      <div className="no-caps text-sm text-fg-muted leading-[1.75] space-y-3 whitespace-pre-line">
        {children}
      </div>
    </div>
  );
}
