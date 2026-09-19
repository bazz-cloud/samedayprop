'use client';

/**
 * The rulebook, searchable.
 *
 * A rules page is read in two ways: swept top to bottom before buying, and
 * jumped into afterwards to answer one question. The sidebar serves the first,
 * the search field serves the second, and both are needed — a trader looking
 * for "news" at 09:29 will not scroll.
 *
 * Search matches a card's title, its summary and its body text, so "trailing",
 * "news" and "payout" all land somewhere useful. Matching is on the text the
 * visitor can actually see; there are no hidden keywords, because a rule that
 * can only be found by guessing a synonym is not findable.
 *
 * Every card carries its own mini-table across all five account sizes, so
 * nobody has to jump back to pricing to find out what their own limit is.
 */

import { useMemo, useState, type ReactNode } from 'react';

export interface RuleTierRow {
  readonly planKey: string;
  readonly label: string;
  readonly values: readonly string[];
}

export interface RuleCard {
  readonly id: string;
  readonly title: string;
  /** One line, shown always. The rule itself, not a teaser for it. */
  readonly summary: string;
  /** Searchable body. Rendered as paragraphs. */
  readonly body: readonly string[];
  /** Attached to the rule it qualifies, never stacked at the foot of the page. */
  readonly caveat?: string;
  readonly table?: {
    readonly columns: readonly string[];
    readonly rows: readonly RuleTierRow[];
  };
}

export interface RuleSection {
  readonly id: string;
  readonly title: string;
  readonly cards: readonly RuleCard[];
}

function matches(card: RuleCard, query: string): boolean {
  if (query === '') return true;
  const haystack = [card.title, card.summary, ...card.body, card.caveat ?? '']
    .join(' ')
    .toLowerCase();
  // Every word must appear somewhere, so "news trading" narrows rather than
  // widening the way an OR would.
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

export function RulesBrowser({
  sections,
  highlightPlanKey,
  children,
}: {
  sections: readonly RuleSection[];
  /** Highlight the row for the size the visitor came from. */
  highlightPlanKey?: string;
  /** Rendered below the searchable cards — policies, agreements, and so on. */
  children?: ReactNode;
}) {
  const [query, setQuery] = useState('');

  const visible = useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          cards: section.cards.filter((card) => matches(card, query)),
        }))
        .filter((section) => section.cards.length > 0),
    [sections, query],
  );

  const totalMatches = visible.reduce((total, section) => total + section.cards.length, 0);

  return (
    <div className="lg:flex lg:gap-10">
      {/* Sidebar. Sticky on desktop; a plain dropdown on a phone, where a
          210px rail would eat half the screen. */}
      <nav aria-label="Rules sections" className="lg:w-[210px] lg:shrink-0">
        <div className="lg:sticky lg:top-24">
          <label htmlFor="rules-jump" className="label lg:hidden">
            Jump to
          </label>
          <select
            id="rules-jump"
            className="no-caps mt-1 w-full rounded-lg border border-border-strong bg-card px-3 py-2.5 lg:hidden"
            defaultValue=""
            onChange={(event) => {
              const target = document.getElementById(event.target.value);
              target?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <option value="" disabled>
              Choose a section
            </option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title}
              </option>
            ))}
          </select>

          <ul className="hidden lg:block space-y-1">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="no-caps block rounded-md px-3 py-1.5 text-sm text-fg-subtle hover:bg-card hover:text-accent transition-colors"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="mt-6 min-w-0 flex-1 lg:mt-0">
        <div>
          <label htmlFor="rules-search" className="label">
            Search the rulebook
          </label>
          <input
            id="rules-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="trailing, news, payout…"
            className="no-caps mt-1 w-full rounded-lg border border-border-strong bg-card px-4 py-3 focus:border-accent"
          />
          <p aria-live="polite" className="no-caps mt-2 text-xs text-fg-fine">
            {query === ''
              ? `${sections.reduce((t, s) => t + s.cards.length, 0)} rules`
              : totalMatches === 0
                ? 'No rule matches that. Every rule is still below — clear the search to see them.'
                : `${totalMatches} matching ${totalMatches === 1 ? 'rule' : 'rules'}`}
          </p>
        </div>

        <div className="mt-8 space-y-10">
          {visible.map((section) => (
            <section key={section.id} aria-labelledby={section.id}>
              <h2 id={section.id} className="text-xl scroll-mt-24">
                {section.title}
              </h2>
              <div className="mt-4 space-y-4">
                {section.cards.map((card) => (
                  <article
                    key={card.id}
                    className="rounded-xl border border-border-strong bg-card p-5"
                  >
                    <h3 className="text-base">{card.title}</h3>
                    <p className="no-caps mt-2 font-bold">{card.summary}</p>

                    {card.body.map((paragraph) => (
                      <p
                        key={paragraph}
                        className="no-caps mt-2 text-sm text-fg-muted leading-relaxed"
                      >
                        {paragraph}
                      </p>
                    ))}

                    {card.table && (
                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full text-sm">
                          <caption className="sr-only">
                            {card.title} for each account size
                          </caption>
                          <thead>
                            <tr className="border-b border-border">
                              {card.table.columns.map((column, index) => (
                                <th
                                  key={column}
                                  scope="col"
                                  className={`px-2 py-2 text-xs font-bold tracking-wide text-fg-subtle ${
                                    index === 0 ? 'text-left' : 'text-right'
                                  }`}
                                >
                                  {column.toUpperCase()}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {card.table.rows.map((row) => {
                              const highlighted = row.planKey === highlightPlanKey;
                              return (
                                <tr
                                  key={row.planKey}
                                  className={`border-b border-border last:border-0 ${
                                    highlighted ? 'bg-card-accent' : ''
                                  }`}
                                >
                                  <th
                                    scope="row"
                                    className="tnum px-2 py-2 text-left font-bold"
                                  >
                                    {row.label}
                                  </th>
                                  {row.values.map((value, index) => (
                                    <td
                                      key={`${row.planKey}-${index}`}
                                      className="tnum px-2 py-2 text-right"
                                    >
                                      {value}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {card.caveat && (
                      <p className="no-caps mt-4 border-t border-border pt-3 text-xs text-fg-fine leading-relaxed">
                        {card.caveat}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>

        {query === '' && children}
      </div>
    </div>
  );
}
