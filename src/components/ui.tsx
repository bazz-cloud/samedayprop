/**
 * Small shared primitives.
 *
 * Kept deliberately minimal — native elements with clear focus states rather
 * than a component library, so keyboard navigation and screen-reader semantics
 * are whatever the browser already does well.
 */

import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return (
    <Tag className={`rounded-xl border border-border bg-surface ${className}`}>{children}</Tag>
  );
}

export function SectionHeading({
  number,
  title,
  hint,
}: {
  number: number;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <span
        aria-hidden="true"
        className="shrink-0 h-7 w-7 rounded-full border border-border-strong bg-surface-raised grid place-items-center text-xs font-semibold text-fg-muted tnum"
      >
        {number}
      </span>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {hint && <p className="text-sm text-fg-subtle mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

type Tone = 'neutral' | 'accent' | 'warn' | 'danger' | 'info';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'border-border-strong bg-surface-raised text-fg-muted',
  accent: 'border-accent/40 bg-accent-dim text-accent',
  warn: 'border-warn/40 bg-warn-dim text-warn',
  danger: 'border-danger/40 bg-danger-dim text-danger',
  info: 'border-info/40 bg-info/10 text-info',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Callout({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-lg border p-4 text-sm ${TONE_CLASSES[tone]}`}>
      {title && <p className="font-semibold mb-1">{title}</p>}
      <div className="leading-relaxed [&_strong]:font-semibold">{children}</div>
    </div>
  );
}

/** Label/value row used throughout the rule panels and dashboards. */
export function DataRow({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-border last:border-0">
      <div className="min-w-0">
        <dt className={`text-sm ${emphasis ? 'text-fg font-medium' : 'text-fg-muted'}`}>{label}</dt>
        {hint && <p className="text-xs text-fg-subtle mt-0.5 leading-relaxed">{hint}</p>}
      </div>
      <dd
        className={`text-sm tnum shrink-0 text-right ${
          emphasis ? 'text-accent font-semibold' : 'text-fg'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

export function StatusDot({ tone }: { tone: Tone }) {
  const colour = {
    neutral: 'bg-fg-subtle',
    accent: 'bg-accent',
    warn: 'bg-warn',
    danger: 'bg-danger',
    info: 'bg-info',
  }[tone];
  return <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${colour}`} />;
}
