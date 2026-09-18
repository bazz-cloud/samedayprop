/**
 * Download a signed document, with its signature evidence attached.
 *
 * Reproduces the EXACT text that was signed from the stored version, not the
 * current one, so a later update to the document cannot retroactively change
 * what a customer's copy says.
 */

import { prisma } from '@/server/db';
import { requireUser } from '@/server/auth/session';
import { hashDocumentBody } from '@/server/legal/documents';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  const { id } = await params;

  const acceptance = await prisma.agreementAcceptance.findUnique({
    where: { id },
    include: { document: true, order: true },
  });

  if (!acceptance || acceptance.userId !== user.id) {
    return new Response('Not found', { status: 404 });
  }

  // Verify the stored text still hashes to what was signed. If it does not,
  // say so on the copy rather than handing over a document that silently
  // differs from the one the signature covers.
  const currentHash = hashDocumentBody(acceptance.document.body);
  const intact = currentHash === acceptance.documentHash;

  const body = [
    '='.repeat(72),
    acceptance.document.title,
    `Version ${acceptance.document.version}`,
    acceptance.document.status === 'DRAFT_PENDING_LEGAL_REVIEW'
      ? 'STATUS: DRAFT PENDING LEGAL REVIEW — not approved by a lawyer'
      : 'STATUS: APPROVED',
    '='.repeat(72),
    '',
    acceptance.document.body,
    '',
    '='.repeat(72),
    'SIGNATURE EVIDENCE',
    '='.repeat(72),
    `Signed by:          ${acceptance.typedLegalName}`,
    `Account email:      ${user.email}`,
    `Signed at:          ${acceptance.signedAt.toISOString()}`,
    `Signature method:   ${acceptance.signatureMethod}`,
    `Document hash:      ${acceptance.documentHash}`,
    `Terms hash:         ${acceptance.quoteHash ?? '(not bound to a quote)'}`,
    `Order reference:    ${acceptance.orderId ?? '(no order)'}`,
    `IP address:         ${acceptance.ipAddress ?? '(not recorded)'}`,
    '',
    'Consent wording shown next to the signature field:',
    acceptance.consentWording,
    '',
    intact
      ? 'Integrity check: the stored document text matches the hash that was signed.'
      : 'WARNING: the stored document text no longer matches the hash that was signed. ' +
        'Contact support before relying on this copy.',
    '',
    'Note: this record evidences agreement. It does not by itself determine whether every',
    'term is enforceable, which depends on the governing law and on a legal review that has',
    'not yet taken place.',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${acceptance.document.slug}-signed.txt"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
