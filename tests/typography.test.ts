/**
 * The typeface and the permission to load it must move together.
 *
 * Satoshi is served from a third-party origin, so it needs two CSP entries to
 * render at all. Nothing about a missing font throws: the page just quietly
 * falls back to Arial and looks almost right, which is exactly the kind of
 * regression that ships. These assertions tie the four pieces together —
 * the stack, the stylesheet link, and the two CSP origins.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const css = read('src/app/globals.css');
const layout = read('src/app/layout.tsx');
const middleware = read('src/middleware.ts');

describe('Satoshi is the one family', () => {
  it.each(['--font-sans', '--font-display', '--font-mono'])('%s leads with Satoshi', (token) => {
    const line = css.split('\n').find((l) => l.trim().startsWith(`${token}:`));
    expect(line).toBeDefined();
    expect(line!).toMatch(/:\s*'Satoshi'/);
  });

  it('keeps Arial as the fallback on every stack, so a failed load reflows rather than rearranges', () => {
    for (const token of ['--font-sans', '--font-display', '--font-mono']) {
      const line = css.split('\n').find((l) => l.trim().startsWith(`${token}:`))!;
      expect(line).toContain('Arial');
    }
  });

  it('loads the font, or the stack above is decoration', () => {
    expect(layout).toContain('api.fontshare.com/v2/css');
    // The weights the design actually uses: body, medium labels, bold headings,
    // and the italics the wordmark needs.
    expect(layout).toMatch(/satoshi@400,401,500,700,701/);
  });

  it('permits the font in the CSP, or it is blocked and silently falls back', () => {
    expect(middleware).toMatch(/style-src[^"]*https:\/\/api\.fontshare\.com/);
    expect(middleware).toMatch(/font-src[^"]*https:\/\/cdn\.fontshare\.com/);
  });

  it('does not open the font origin up to anything but the font', () => {
    // fontshare must not appear in connect-src or script-src: a typeface host
    // has no business being reachable by script.
    // Directive lines only. The comment above the policy names both
    // connect-src and fontshare in one sentence, and matching that would make
    // this test pass or fail on prose.
    const directives = middleware
      .split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
    const connect = directives.find((l) => l.includes('connect-src'))!;
    const script = directives.find((l) => l.includes('script-src'))!;
    expect(connect).not.toContain('fontshare');
    expect(script).not.toContain('fontshare');
  });
});

describe('case and weight', () => {
  it('sets headings to bold capitals', () => {
    const block = css.slice(css.indexOf('h1,'), css.indexOf('h1,') + 300);
    expect(block).toContain('font-weight: 700');
    expect(block).toContain('text-transform: uppercase');
  });

  it('gives table titles and column headers the same treatment', () => {
    const block = css.slice(css.indexOf('caption,\nth['), css.indexOf('caption,\nth[') + 220);
    expect(block).toContain('font-weight: 700');
    expect(block).toContain('text-transform: uppercase');
  });

  it('leaves body copy in sentence case', () => {
    const body = css.slice(css.indexOf('body {'), css.indexOf('body {') + 260);
    expect(body).not.toContain('text-transform');
  });

  it('turns on tabular figures, since one family now carries the words and the numbers', () => {
    expect(css).toContain('font-variant-numeric: tabular-nums slashed-zero');
  });
});

/**
 * The dashboard hero.
 *
 * It leads with room to the floor rather than the account balance, and that is
 * a deliberate choice worth defending against a future edit: a simulated
 * balance is not cash and tells a trader nothing about whether the next trade
 * can end their account.
 */
describe('dashboard hero', () => {
  const hero = read('src/components/DashboardHero.tsx');
  const page = read('src/app/dashboard/page.tsx');

  it('leads with room to the floor', () => {
    expect(hero).toContain('Room to the floor');
    // Before the status card, which is provenance rather than a decision.
    expect(page.indexOf('<DashboardHero')).toBeLessThan(page.indexOf('---- status ----'));
  });

  it('never shows a bar without the figures beside it', () => {
    // Every meter carries a text label, and each caller prints the real values.
    expect(hero).toContain('role="meter"');
    expect(hero).toContain('aria-valuenow');
    expect(hero).toMatch(/aria-label=\{label\}/);
  });

  it('never tells an account that cannot trade how close it is to a payout', () => {
    expect(page).toContain('!account.isTradeable');
    expect(page).toMatch(/kind: 'blocked'/);
  });

  it('says so when the figures are not current, rather than showing them plainly', () => {
    expect(hero).toContain('These figures are not current');
  });

  it('warns about staleness exactly once', () => {
    // It used to appear in the status card as well, which trained people to
    // skip both.
    const occurrences = page.match(/not current/g) ?? [];
    expect(occurrences.length).toBeLessThanOrEqual(1);
  });
});
