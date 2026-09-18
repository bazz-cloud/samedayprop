# Product specification

Current state of the product as built. Companion documents:
`DECISIONS.md` (what is settled), `PAYOUT_AND_RISK_RULES.md` (exact algorithms),
`TRADOVATE_CAPABILITIES.md` (external dependencies), `LEGAL_REVIEW.md`,
`OPERATIONS.md`, `LAUNCH_CHECKLIST.md`.

---

## 1. What the business does

Traders buy one-time access to a **simulated** futures account. There is no
evaluation phase. Revenue comes from account purchase fees and optional paid
services.

### The accounting model, which is the part most easily got wrong

- A simulated trading **gain** creates no cash revenue.
- A simulated trading **loss** creates no cash revenue and is **not** a company
  trading loss. The company never had that money.
- A **$500 gross withdrawal** reduces the simulated account by $500 and pays the
  trader **$250 in real cash** from company funds.
- The other **$250 is received by no one**. It is simulated balance that ceases
  to exist, and it is never recorded as revenue.
- Real vendor bills, refunds, chargebacks, acquisition spend and actual trader
  payouts affect company cash separately.

This is enforced structurally: four separate append-only ledgers, with the
SIMULATION ledger unable to post to any cash or revenue account
(`assertNoSimulatedRevenue`). A paid reward produces three entries and zero
revenue entries.

This application operates a **simulation program only**. There is no live copy
trading and no assumption that live-market profits finance payouts.

## 2. Architecture

```
src/domain/     Pure TypeScript. No framework, no database, no I/O.
                Money, catalog, pricing, risk, payout, ledger, economics.
src/server/     Config, persistence, auth, provider adapters, services, jobs.
src/app/        Next.js App Router: public site, checkout, dashboards, API.
src/components/ React components.
tests/          Vitest: unit + end-to-end against a real database.
```

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript 5.9 (strict, with
`noUncheckedIndexedAccess`) · Prisma 6 · SQLite for development, PostgreSQL for
production · Tailwind CSS v4 · Vitest.

**Why this shape.** Business rules live in `src/domain` as pure functions, so
the same code backs the UI, the API routes, the background workers and the
tests. Nothing about a payout limit is re-implemented in a component.

**Money.** Integer minor units on `bigint` everywhere — domain, database
(`BigInt` columns), API (strings), browser. Binary floating point never touches
a balance. Percentages are exact rationals.

**Durability.** Local state changes run in database transactions. External
effects go through a DB-backed job queue written in the same transaction, so a
crash between "state changed" and "side effect dispatched" loses nothing.

## 3. Catalog

Five account sizes, one-time purchase, not subscriptions. Confirmed list prices
and confirmed coupon prices are in `DECISIONS.md` and asserted exactly in tests.

Risk parameters per plan (drawdown allowance, daily loss limit, retained buffer,
daily cash cap) are **PROPOSED development defaults**. Lifetime cash payout caps
are **UNRESOLVED**. Both block production sale.

A **published `PlanVersion` is the contractual artifact**; the code catalog is
only the editorial source. An order points at a version, so editing a price
tomorrow cannot rewrite what someone bought today. Admin edits create version
N+1.

### Add-ons

Three candidate products (Trading Journal Kit $19, Advanced Analytics $29,
Guided Setup $49), all PROPOSED and disabled for production sale.

Guided Setup requires real scheduling capacity: checkout refuses it when no slot
exists, rather than taking money for a session that cannot be delivered.

**Never behind a paywall:** basic account statistics, rules access, payout
eligibility, requesting a payout, receiving an earned payout, basic CSV export,
account security, ordinary support, receipts, signed-document download.

## 4. Public site

Home · account comparison and configurator · rules · FAQ · checkout ·
login/register · support · legal documents.

Dark configurator: numbered sections left, sticky order summary and the selected
plan's full rule panel right, fixed bottom bar on mobile so the total and
primary action stay reachable.

- Native radios and checkboxes, restyled — keyboard navigation, spacebar
  toggling and screen-reader semantics come from the browser.
- **The browser performs no arithmetic on money.** Plan views are computed
  server-side; totals re-fetch from `/api/quotes/preview` on every change.
- Every non-confirmed term carries a status chip.
- No decorative charts, activity feeds, testimonials, customer counts or trust
  badges. None of it would be true.

Account cards show: nominal size, list and coupon price with condition, one-time
billing, position ceiling with the combined-exposure explanation, daily loss
limit and consequence, trailing drawdown with unrealized treatment and stopping
point, retained buffer with an exact first-withdrawal example, the 50/50 split,
minimum gross and cash, daily and lifetime caps, no-evaluation/no-consistency/
first-day eligibility, cost treatment and platform access.

## 5. Checkout

1. Register or sign in.
2. Select plan and optional extras. Tradovate is the only platform, so no fake
   platform choice is shown.
3. Apply a coupon — recomputed server-side from the trusted catalog.
4. Review exact terms; acknowledge each agreement (**unchecked by default**) and
   sign by typing a full legal name.
5. Pay through a hosted/tokenised provider. Card details never reach this app.
6. On verified payment, provision asynchronously with truthful progress.

**The signature is bound to the quote hash.** If the plan, rules or price change
between signing and charging, the recomputed hash differs and the order is
refused — the customer re-reviews rather than being charged different terms.

Server enforces discount scope, non-stacking, use limits, expiry, currency and
rounding, with deterministic allocation reused on refund. Coupon limits are
checked **inside** the order transaction, so concurrent submissions cannot both
pass. No preselected paid add-ons, no hidden renewals, no countdowns, no
scarcity claims.

## 6. Provisioning

```
payment_pending → paid → provisioning → provisioned_unverified
                → risk_verified → active
```
plus `provisioning_failed_retryable`, `manual_review`,
`provisioning_failed_permanent`.

**`active` is reachable only from `risk_verified`.** An account is never
presented as tradeable until the provider has confirmed by **read-back** that
the risk limits are in place. A call that did not throw is not confirmation.

Duplicate webhooks and retried jobs never create a second identity or account.
A failure after successful payment shows a truthful pending or failed state,
retries a bounded number of times, then escalates — never claiming an account
exists when it does not.

Credentials: invitation or scoped token only. A reusable plaintext password is
never emailed and never stored retrievably.

## 7. Risk engine

Enforced server-side against authoritative provider data. Browser UI is not
enforcement, and polling alone is not described as reliable intraday protection.

Trailing threshold `T = min(S + $100, H − D)`, rising on unrealized peaks, never
falling after a loss or a withdrawal. Daily loss on session P&L with withdrawal
deductions excluded. Sessions in an IANA zone, DST-correct. Exposure in
micro-equivalents counting pending orders, charging an OCO set its largest leg,
refusing to net unrelated instruments, and refusing unapproved instruments
entirely.

Events stored raw and normalised with provider sequence; duplicates and
out-of-order arrivals recorded but not applied. Stale data blocks payouts and
new exposure and raises an alert. Enforcement is two-phase: a flatten is
**requested**, then separately **confirmed**, and an unconfirmed request is
reported as such rather than as a closed position.

Full detail in `PAYOUT_AND_RISK_RULES.md` §3.

## 8. Payout engine

`Gmax = max(0, min(A − S − B, 2C, 2L, A − T − room))`, floored to whole dollars,
eligible at $500, paying exactly half in cash. No consistency, best-day or
minimum-day term exists anywhere in eligibility.

Capacity reserved at request time and attributed to the requesting session.
A submitted payout can never be cancelled. An unknown payment outcome routes to
`needs_reconciliation` and the simulated deduction is reversed **only** on a
confirmed non-payment.

Full detail in `PAYOUT_AND_RISK_RULES.md` §4.

## 9. Trader dashboard

Account selector; provisioning and access status; platform access instructions;
simulated balance and equity; unrealized P&L; commissions; daily loss usage;
trailing threshold and remaining room; exposure against cap; retained buffer;
eligible gross and corresponding cash; remaining daily and lifetime capacity;
payout request and history; account events with plain-language reasons; extras;
receipts and signed documents; security and support.

Last sync time and stale status are always shown. Simulated figures are labelled
as simulated and never presented as a cash wallet. Basic CSV export requires no
purchase. Empty, pending, failed, restricted and disconnected states are all
handled.

## 10. Admin console

Role-based (`OWNER`/`FINANCE`/`SUPPORT`/`RISK`), MFA required for all four.

Live launch gate assembled from provider capabilities, unapproved commercial
terms, draft legal documents, unconfigured tax and unapproved instruments. Real
cash reporting kept separate from simulated units. Payout queue with reservation
totals and transition history. Per-ledger balance verification. Alerts for
unresolved payment outcomes, unprovisioned paid orders, stale accounts and dead
jobs.

**Sensitivity calculator** with editable assumptions, reproducing the reference
math exactly: $449.25 − $120 − (30% × $1,000) = **$29.25** contribution before
overhead; **−$3.75** at 33.3%. Reports the payout probability at which
contribution hits zero, and refuses to treat active unpaid accounts as proven
zero-payout outcomes. Simulated retained profit never appears as revenue.

## 11. Security

Hosted payment inputs, no raw card data. scrypt passwords with stored parameters
and transparent rehash. Session tokens stored only as SHA-256. Double-submit
CSRF on cookie-authenticated mutations; server actions carry an origin check.
Object-level authorisation checked at every entry point. Rate limiting and
account lockout on login. Registration responses do not reveal whether an
address exists. Security headers set globally. CSV export guards against formula
injection. No password, token or identity-document logging.

## 12. Testing

176 tests. Unit coverage of money, pricing, coupons, allocation, sessions and
DST, trailing drawdown, daily loss, exposure, payout capacity, reservations,
state machines, ledgers and economics. End-to-end coverage against a real
database of purchase → signature → payment → provisioning → risk → payout →
signed-document evidence, plus duplicate webhooks, concurrent cap exhaustion,
unknown payment outcomes, stale data, risk read-back failure, provisioning
retry, coupon limits under concurrency and cross-customer authorisation.

## 13. What is not built

- **No real Tradovate integration.** Every capability is UNVERIFIED and the
  adapter throws. See `TRADOVATE_CAPABILITIES.md`.
- **No real payment provider.** Mock only; production refuses to boot without one.
- **No cash payout rail.** `submitPayout` applies the simulated deduction and
  then parks for an operator, rather than pretending money moved.
- **No real email.** Local outbox only.
- **No identity verification provider.** Status is `NOT_CONFIGURED`, never a
  fabricated `VERIFIED`.
- **No password reset flow**, because it requires email.
- **No approved legal documents.** All seven are drafts.
- **No tax configuration.**
