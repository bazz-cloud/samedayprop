/**
 * Disclosures that survive every compression pass.
 *
 * The site is being cut down page by page, and the failure mode of that work is
 * a disclosure disappearing because it read like padding. These are the
 * sentences that must still be there afterwards, asserted against the page
 * sources so a rewrite that drops one fails here rather than in front of a
 * regulator.
 *
 * Matching is on normalised text: whitespace collapsed and the typographic
 * entities the pages use folded back to plain characters, so reflowing a
 * paragraph is allowed and changing its words is not.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

function pageText(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8')
    .replace(/&rsquo;|&apos;/g, "'")
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/\{'\s*'\}/g, ' ')
    .replace(/\s+/g, ' ');
}

const REQUIRED: readonly { page: string; label: string; text: string }[] = [
  {
    page: 'src/app/payouts/page.tsx',
    label: 'settlement timing is not guaranteed',
    text: 'We do not guarantee same-day receipt of funds in your bank account, and you should be sceptical of anyone who does.',
  },
  {
    page: 'src/app/payouts/page.tsx',
    label: 'the other half is not income to us',
    text: 'The other $250 is not income to us. It is simulated balance that ceases to exist.',
  },
  {
    page: 'src/app/payouts/page.tsx',
    label: 'capacity is reserved at request time',
    text: 'Capacity is reserved when you request, not when you are paid',
  },
  {
    page: 'src/components/HomeHero.tsx',
    label: 'account size is a nominal figure',
    text: 'Trading is simulated and the account size is a nominal figure, not cash held for you.',
  },
  {
    page: 'src/app/page.tsx',
    label: 'no guarantee of profits',
    text: 'We do not guarantee profits, rewards or payouts of any kind.',
  },
  {
    page: 'src/app/page.tsx',
    label: 'most participants receive nothing',
    text: 'Most participants in programs of this kind do not receive a payout.',
  },
  {
    page: 'src/app/page.tsx',
    label: 'you can lose the fee',
    text: 'You can breach a limit and lose access to the account, and the purchase fee with it.',
  },
  {
    page: 'src/app/page.tsx',
    label: 'no claim of regulatory approval',
    text: 'We make no claim of regulatory approval or registration',
  },
  {
    page: 'src/app/rules/page.tsx',
    label: 'the agreements govern where they differ',
    text: ', which govern if they differ.',
  },
  {
    page: 'src/app/rules/page.tsx',
    label: 'accounts are not sold while terms are unapproved',
    text: 'Accounts are not sold for real money while any term remains unapproved.',
  },
  {
    page: 'src/app/accounts/page.tsx',
    label: 'accounts are not sold while terms are unapproved',
    text: 'Accounts are not sold for real money while any term above remains unapproved.',
  },
  {
    page: 'src/components/AccountConfigurator.tsx',
    label: 'balance is a nominal figure',
    text: 'the balance is a nominal figure, not cash held for you.',
  },
];

describe('disclosures survive compression', () => {
  it.each(REQUIRED)('$page keeps: $label', ({ page, text }) => {
    expect(pageText(page)).toContain(text);
  });
});

describe('the important disclosures footer', () => {
  const footer = pageText('src/components/SiteFooter.tsx');

  it.each([
    ['all trading is simulated', 'All trading in this program is simulated.'],
    ['account sizes are not cash', 'Account sizes are nominal figures, not cash.'],
    ['you can lose the fee and receive nothing', 'You can lose the fee you pay and receive nothing.'],
    ['no payout is guaranteed', 'No profit, reward or payout is guaranteed.'],
  ])('keeps: %s', (_label, text) => {
    expect(footer).toContain(text);
  });
});
