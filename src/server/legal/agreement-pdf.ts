/**
 * The combined agreement PDF.
 *
 * Every document required at checkout, in one file, with a signature block at
 * the end. One document and one signature, rather than a separate tick per
 * agreement.
 *
 * What does NOT change: the per-document evidence. Each document's title,
 * version and body hash is printed in a manifest on the first page and recorded
 * separately in the database, so "what exactly did this person sign" still has
 * an exact answer afterwards. A single signature over an unidentified bundle
 * would be worth very little.
 *
 * The e-signature consent wording sits immediately above the signature line
 * rather than being its own agreement. That is the usual arrangement, and worth
 * knowing: consent to sign electronically is being given by the same act it
 * authorises. Counsel should confirm that is acceptable in the governing
 * jurisdiction, which has not been chosen yet.
 *
 * Rendered with the standard Helvetica face, which needs no embedded font file
 * and therefore no font licensing question.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface AgreementDocument {
  readonly slug: string;
  readonly title: string;
  readonly version: number;
  readonly body: string;
  readonly bodyHash: string;
  readonly isDraft: boolean;
}

export interface AgreementPdfInput {
  readonly documents: readonly AgreementDocument[];
  readonly companyName: string;
  readonly customerName: string | null;
  readonly customerEmail: string;
  readonly quoteId: string;
  readonly totalDisplay: string;
  readonly planLabel: string;
  /** Present once signed; absent on the review copy. */
  readonly signature?: {
    readonly typedLegalName: string;
    readonly signedAt: Date;
    readonly consentWording: string;
  };
}

const PAGE = { width: 595.28, height: 841.89 }; // A4 portrait, in points
const MARGIN = 56;
const BODY_SIZE = 9;
const LINE_HEIGHT = 12.5;

const INK = rgb(0.08, 0.08, 0.09);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.78, 0.78, 0.8);

/**
 * Greedy wrap by measured width.
 *
 * A word longer than the line (a hash, a URL) is broken rather than allowed to
 * run off the page — legal text that silently loses characters at the margin is
 * worse than an ugly break.
 */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }

    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line !== '') lines.push(line);

      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        line = word;
        continue;
      }

      // Break the oversized word across lines.
      let chunk = '';
      for (const character of word) {
        if (font.widthOfTextAtSize(chunk + character, size) > maxWidth) {
          lines.push(chunk);
          chunk = character;
        } else {
          chunk += character;
        }
      }
      line = chunk;
    }
    lines.push(line);
  }

  return lines;
}

export async function buildAgreementPdf(input: AgreementPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const contentWidth = PAGE.width - MARGIN * 2;
  let page: PDFPage = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  const newPage = () => {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
  };

  const need = (space: number) => {
    if (y - space < MARGIN + 28) newPage();
  };

  const write = (
    text: string,
    options: { font?: PDFFont; size?: number; color?: typeof INK; gap?: number } = {},
  ) => {
    const font = options.font ?? body;
    const size = options.size ?? BODY_SIZE;
    const lineHeight = size * 1.38;

    for (const line of wrap(text, font, size, contentWidth)) {
      need(lineHeight);
      if (line !== '') {
        page.drawText(line, {
          x: MARGIN,
          y: y - size,
          size,
          font,
          color: options.color ?? INK,
        });
      }
      y -= lineHeight;
    }
    y -= options.gap ?? 0;
  };

  const rule = () => {
    need(10);
    page.drawLine({
      start: { x: MARGIN, y: y - 4 },
      end: { x: PAGE.width - MARGIN, y: y - 4 },
      thickness: 0.5,
      color: RULE,
    });
    y -= 14;
  };

  // ---- cover ---------------------------------------------------------------
  write(input.companyName, { font: bold, size: 16 });
  write('Trader agreement and related terms', { font: bold, size: 12, gap: 6 });
  rule();

  write(`Customer: ${input.customerName ?? '—'} (${input.customerEmail})`, { color: MUTED });
  write(`Account: ${input.planLabel}`, { color: MUTED });
  write(`Order total: ${input.totalDisplay}`, { color: MUTED });
  write(`Quote reference: ${input.quoteId}`, { color: MUTED });
  write(`Generated: ${new Date().toISOString()}`, { color: MUTED, gap: 10 });

  write('Documents included in this file', { font: bold, size: 10, gap: 4 });
  input.documents.forEach((document, index) => {
    write(`${index + 1}. ${document.title} (version ${document.version})`, { size: 8 });
    write(`    sha256 ${document.bodyHash}`, { size: 7, color: MUTED });
    if (document.isDraft) {
      write('    DRAFT PENDING LEGAL REVIEW — not yet approved by a lawyer.', {
        size: 7,
        color: MUTED,
      });
    }
  });

  y -= 8;
  rule();
  write(
    'Signing this file signs every document listed above. Each is reproduced in full below, and ' +
      'each hash identifies the exact text signed.',
    { size: 8, color: MUTED },
  );

  // ---- the documents -------------------------------------------------------
  for (const document of input.documents) {
    newPage();
    write(document.title, { font: bold, size: 13 });
    write(`Version ${document.version} · sha256 ${document.bodyHash}`, {
      size: 7,
      color: MUTED,
      gap: 4,
    });
    if (document.isDraft) {
      write('DRAFT PENDING LEGAL REVIEW — not yet approved by a lawyer.', {
        font: bold,
        size: 8,
        gap: 2,
      });
    }
    rule();
    write(document.body, { size: BODY_SIZE });
  }

  // ---- signature -----------------------------------------------------------
  newPage();
  write('Signature', { font: bold, size: 13, gap: 4 });
  rule();

  if (input.signature) {
    write(input.signature.consentWording, { size: 9, gap: 10 });
    write('Signed by', { size: 8, color: MUTED });
    write(input.signature.typedLegalName, { font: bold, size: 15, gap: 6 });
    write(`Signed at ${input.signature.signedAt.toISOString()}`, { size: 8, color: MUTED });
    write(`Quote reference ${input.quoteId}`, { size: 8, color: MUTED, gap: 10 });
    write(
      'This signature was made by typing the name above into the checkout form and submitting it. ' +
        'The time, the exact documents listed on the first page and limited technical evidence were ' +
        'recorded with it.',
      { size: 8, color: MUTED },
    );
  } else {
    write(
      'This is a review copy. It has not been signed. Signing happens in the checkout form, where ' +
        'you type your full legal name and submit.',
      { size: 9, gap: 14 },
    );
    write('Signature', { size: 8, color: MUTED, gap: 24 });
    rule();
    write('Date', { size: 8, color: MUTED, gap: 24 });
    rule();
  }

  // ---- page numbers --------------------------------------------------------
  const pages = pdf.getPages();
  pages.forEach((current, index) => {
    current.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: MARGIN,
      y: MARGIN - 18,
      size: 7,
      font: body,
      color: MUTED,
    });
  });

  return pdf.save();
}

export const PDF_LINE_HEIGHT = LINE_HEIGHT;
