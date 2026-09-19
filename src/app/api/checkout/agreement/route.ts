/**
 * The combined agreement PDF for a quote.
 *
 * Serves a review copy before signing and, once the quote has been signed, the
 * same file with the signature block filled in. The document bodies come from
 * the stored versions rather than the current ones, so a later edit cannot
 * retroactively change what a customer's copy says.
 */

import { prisma } from '@/server/db';
import { requireUser } from '@/server/auth/session';
import { getConfig } from '@/server/config';
import { buildAgreementPdf } from '@/server/legal/agreement-pdf';
import { requiredDocuments } from '@/server/services/checkout-service';
import { Money } from '@/domain/money/money';
import { getPlan, isPlanKey } from '@/domain/catalog/plans';

export async function GET(request: Request) {
  const user = await requireUser();
  const config = getConfig();

  const quoteId = new URL(request.url).searchParams.get('quoteId');
  if (!quoteId) {
    return new Response('A quote reference is required.', { status: 400 });
  }

  const quote = await prisma.quote.findUnique({ where: { id: quoteId } });
  // A quote belongs to the customer who created it. An anonymous quote (userId
  // null) is not served here: without an owner there is nobody to serve it to.
  if (!quote || quote.userId !== user.id) {
    return new Response('That quote was not found.', { status: 404 });
  }

  const documents = await requiredDocuments();

  // Signed already? Then the file shows the signature that was actually made,
  // not a fresh one generated at download time.
  const acceptance = await prisma.agreementAcceptance.findFirst({
    where: { userId: user.id, quoteId },
    orderBy: { signedAt: 'asc' },
  });

  const pdf = await buildAgreementPdf({
    documents: documents.map((document) => ({
      slug: document.slug,
      title: document.title,
      version: document.version,
      body: document.body,
      bodyHash: document.bodyHash,
      isDraft: document.status === 'DRAFT_PENDING_LEGAL_REVIEW',
    })),
    companyName: config.company.name,
    customerName: user.legalName,
    customerEmail: user.email,
    quoteId,
    totalDisplay: Money.fromMinor(quote.totalMinor).format(),
    planLabel: isPlanKey(quote.planKey) ? getPlan(quote.planKey).label : quote.planKey,
    signature: acceptance
      ? {
          typedLegalName: acceptance.typedLegalName,
          signedAt: acceptance.signedAt,
          consentWording: acceptance.consentWording,
        }
      : undefined,
  });

  return new Response(pdf as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="bull-rush-agreement-${quoteId}.pdf"`,
      // Contains the customer's name and order. Never cached by a proxy.
      'cache-control': 'private, no-store',
    },
  });
}
