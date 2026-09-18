import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/server/db';
import { Callout } from '@/components/ui';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const document = await prisma.legalDocumentVersion.findFirst({
    where: { slug },
    orderBy: { version: 'desc' },
  });
  return { title: document?.title ?? 'Policy' };
}

export default async function LegalDocumentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const document = await prisma.legalDocumentVersion.findFirst({
    where: { slug },
    orderBy: { version: 'desc' },
  });

  if (!document) notFound();

  const isDraft = document.status === 'DRAFT_PENDING_LEGAL_REVIEW';

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">{document.title}</h1>
        <p className="mt-2 text-sm text-fg-subtle">
          Version {document.version} &middot; content hash{' '}
          <span className="font-mono">{document.bodyHash.slice(0, 16)}…</span>
        </p>
      </header>

      {isDraft && (
        <div className="mb-6">
          <Callout tone="warn" title="This is a draft pending legal review">
            This document has not been reviewed or approved by a lawyer. It is a working draft
            prepared so the product flow can be tested, and it is not legal advice. Sections marked
            as not supplied are material terms the owner and counsel must complete. Accounts are not
            sold for real money while any required document is still a draft.
          </Callout>
        </div>
      )}

      {/*
        Rendered as preformatted text rather than parsed markup: this is the
        exact byte sequence that was hashed and signed, so displaying anything
        other than it verbatim would break the correspondence between what was
        shown and what the signature covers.
      */}
      <article className="rounded-xl border border-border bg-surface p-6">
        <pre className="whitespace-pre-wrap font-sans text-sm text-fg-muted leading-relaxed">
          {document.body}
        </pre>
      </article>

      <p className="mt-6 text-xs text-fg-subtle">
        The hash above identifies this exact text. When you sign at checkout we store this hash
        alongside the exact price and rules you agreed to, so the version you signed stays
        reproducible even after later updates.
      </p>
    </div>
  );
}
