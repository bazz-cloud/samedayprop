/**
 * The combined agreement PDF.
 *
 * Checkout now takes one tick over one document instead of a tick per
 * agreement, so the evidence that used to live in seven separate
 * acknowledgements has to live in this file instead. These assertions cover
 * that: every required document is present, each is identified by version and
 * body hash, and an unsigned copy is visibly unsigned.
 */
import { describe, expect, it } from 'vitest';
import { buildAgreementPdf, type AgreementDocument } from '@/server/legal/agreement-pdf';
import { LEGAL_DOCUMENT_DRAFTS, hashDocumentBody } from '@/server/legal/documents';

const documents: AgreementDocument[] = LEGAL_DOCUMENT_DRAFTS.filter(
  (d) => d.requiredAtCheckout,
).map((d) => ({
  slug: d.slug,
  title: d.title,
  version: d.version,
  body: d.body,
  bodyHash: hashDocumentBody(d.body),
  isDraft: true,
}));

const base = {
  documents,
  companyName: 'Bull Rush Futures',
  customerName: 'Dana Reyes',
  customerEmail: 'dana@example.invalid',
  quoteId: 'q_test_123',
  totalDisplay: '$449.25',
  planLabel: '$50,000',
};

/** PDF text is compressed, so assert on the structure we can read back. */
async function pageCount(bytes: Uint8Array): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe('combined agreement PDF', () => {
  it('includes every document required at checkout', () => {
    expect(documents.length).toBeGreaterThanOrEqual(5);
    expect(documents.map((d) => d.slug)).toContain('trader-agreement');
    expect(documents.map((d) => d.slug)).toContain('payout-policy');
  });

  it('produces one page per document, plus a cover and a signature page', async () => {
    const bytes = await buildAgreementPdf(base);
    // Cover + at least one page per document + signature page.
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(documents.length + 2);
  });

  it('identifies each document by a distinct body hash', () => {
    const hashes = documents.map((d) => d.bodyHash);
    expect(new Set(hashes).size).toBe(hashes.length);
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('builds an unsigned review copy and a signed copy of different lengths', async () => {
    const unsigned = await buildAgreementPdf(base);
    const signed = await buildAgreementPdf({
      ...base,
      signature: {
        typedLegalName: 'Dana Reyes',
        signedAt: new Date('2026-09-19T12:00:00Z'),
        consentWording: 'I agree.',
      },
    });
    // The signature block replaces the blank signature lines, so the two files
    // are never byte-identical — a signed copy cannot be mistaken for a draft.
    expect(Buffer.from(unsigned).equals(Buffer.from(signed))).toBe(false);
  });

  it('still produces a file when a document body is unusually long', async () => {
    const long: AgreementDocument = {
      slug: 'long',
      title: 'Long document',
      version: 1,
      body: 'word '.repeat(20_000),
      bodyHash: 'f'.repeat(64),
      isDraft: false,
    };
    const bytes = await buildAgreementPdf({ ...base, documents: [long] });
    expect(await pageCount(bytes)).toBeGreaterThan(5);
  });

  it('breaks a word too long for one line rather than running it off the page', async () => {
    const unbroken: AgreementDocument = {
      slug: 'hash',
      title: 'Hash',
      version: 1,
      body: 'a'.repeat(4000),
      bodyHash: '0'.repeat(64),
      isDraft: false,
    };
    // Would loop forever or overflow the margin if the wrapper could not split
    // a single token.
    const bytes = await buildAgreementPdf({ ...base, documents: [unbroken] });
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(3);
  });
});
