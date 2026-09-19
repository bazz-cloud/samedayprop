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
import { ADDONS } from '@/domain/catalog/addons';
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
    // The figure is interpolated from the plan now that the worked example
    // scales with account size, so the guard pins the sentence, not the number.
    text: 'is not income to us. It is simulated balance that ceases to exist.',
  },
  // The worked examples show a withdrawal larger than the minimum on every
  // account above $25,000. That is a presentation choice with a disclosure
  // attached: a bigger example must never read as a bigger floor, so each page
  // that scales its example has to keep saying what the minimum actually is.
  {
    page: 'src/app/payouts/page.tsx',
    label: 'the scaled example is not the minimum',
    text: 'That amount is an example, not a minimum: the smallest withdrawal on any account is',
  },
  {
    page: 'src/app/page.tsx',
    label: 'the scaled example is not the minimum',
    text: 'The amount above is an example, not a threshold: the smallest withdrawal on any account is',
  },
  {
    page: 'src/components/WithdrawalCalculator.tsx',
    label: 'the scaled example is not the minimum',
    text: 'This is an example, not a floor or a target:',
  },
  {
    page: 'src/components/WithdrawalCalculator.tsx',
    label: 'the minimum withdrawal is still stated',
    text: 'the smallest withdrawal on any account is',
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
  // Checkout. This page was rebuilt to look like a checkout, and the failure
  // mode of that work is a warning losing its box in the rearrangement. These
  // are the four sentences that have to survive any layout of it.
  {
    page: 'src/components/CheckoutForm.tsx',
    label: 'you can lose the fee you paid',
    text: 'This is a simulated account. You can breach a limit, lose access and lose this fee. Most participants in programs of this kind do not receive a payout.',
  },
  {
    page: 'src/components/CheckoutForm.tsx',
    label: 'signing is not a guarantee of enforceability',
    text: 'It does not by itself guarantee that every term is enforceable',
  },
  {
    page: 'src/components/CheckoutForm.tsx',
    label: 'card details never touch this site',
    text: 'Card details are never entered on or stored by this site.',
  },
  {
    page: 'src/app/checkout/page.tsx',
    label: 'the signature is bound to this price and rule set',
    text: 'Your signature is bound to this exact price and rule set.',
  },
  {
    page: 'src/app/checkout/page.tsx',
    label: 'production blockers are shown, not hidden',
    text: 'This purchase cannot be made with real money yet, for these reasons:',
  },
  {
    page: 'src/components/CheckoutSummary.tsx',
    label: 'tax is not configured',
    text: 'Tax treatment has not been configured, so this total excludes any tax that may apply.',
  },
  {
    page: 'src/components/SiteFooter.tsx',
    label: 'advertised prices exclude sales tax',
    text: 'Michigan sales tax of 6% is added to the discounted total at checkout',
  },
  {
    // Two add-ons now change risk limits, so a blanket "no paid extra changes
    // your rules" would be false. What must stay true, and is what the system
    // actually enforces, is that nothing purchasable improves a payout.
    page: 'src/components/AccountConfigurator.tsx',
    label: 'no extra changes the payout terms',
    text: 'Nothing sold here changes your trailing drawdown, your payout split, your daily cash cap or your lifetime cap, and nothing here is required to get paid.',
  },
  {
    // The ticker advertises the terms it is offering. If the coupon ever gains
    // an expiry or a usage limit, this line becomes false and has to move with
    // it — the test is here so it cannot be forgotten.
    page: 'src/components/PromoTicker.tsx',
    label: 'the code carries no expiry and no usage limit',
    text: 'No expiry, no limit on uses',
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

/**
 * The upgrade rows sit on the payment screen, which is where an omission is
 * worth the most money.
 *
 * Asserted against the catalog values rather than the file text, because these
 * strings are assembled from concatenated literals and because what has to stay
 * true is what the page RENDERS, not how the source is wrapped.
 */
describe('every paid upgrade states what it costs you', () => {
  it.each(ADDONS.map((addon) => [addon.name, addon] as const))('%s', (_name, addon) => {
    expect(addon.limitation.length).toBeGreaterThan(40);
    // It must name something it does NOT improve...
    expect(addon.limitation).toMatch(/does not change/i);
    // ...and it must say the upgrade cuts both ways, not only that it is a perk.
    expect(addon.limitation).toMatch(/threshold/i);
  });

  it('never claims an upgrade improves a payout', () => {
    for (const addon of ADDONS) {
      const copy = `${addon.name} ${addon.description} ${addon.limitation}`.toLowerCase();
      expect(copy).not.toMatch(/better chance|more likely to (pass|get paid)|improves? your odds/);
    }
  });
});
