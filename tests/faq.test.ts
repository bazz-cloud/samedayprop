/**
 * FAQ answers stay short.
 *
 * The 40-word ceiling is a diagnostic as much as a style rule: an answer that
 * will not fit usually means the underlying rule has no clear home of its own,
 * and the fix is a better page rather than a longer answer here. Asserted so a
 * future edit cannot quietly reintroduce a paragraph.
 */
import { describe, expect, it } from 'vitest';
import { FAQS } from '@/app/faq/page';

const LIMIT = 40;

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

describe('FAQ answers', () => {
  it.each(FAQS.map((faq) => [faq.q, faq.a] as const))('%s', (_q, a) => {
    expect(wordCount(a)).toBeLessThanOrEqual(LIMIT);
  });

  it('asks every question exactly once', () => {
    expect(new Set(FAQS.map((f) => f.q)).size).toBe(FAQS.length);
  });

  it('keeps the simulated-trading disclosure in the answer that carries it', () => {
    const simulated = FAQS.find((f) => f.q === 'Is this real money trading?');
    expect(simulated?.a).toContain('All trading in this program is simulated');
    expect(simulated?.a).toContain('nominal figure, not cash held for you');
  });

  it('points every link at a real section of this site', () => {
    for (const faq of FAQS) {
      if (!faq.link) continue;
      expect(faq.link.href).toMatch(/^\/[a-z-]*(#[a-z-]+)?$/);
    }
  });
});
