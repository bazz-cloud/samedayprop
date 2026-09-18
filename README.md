# Simulated futures prop-firm platform

A working instant-funded futures prop-firm platform: public site, configurable
account selector, checkout with signed agreements, trader dashboard,
owner/admin console, a trading-provider integration layer, a server-side risk
engine and a payout engine with real ledgers.

It runs end to end locally with no external credentials. It is **not** ready to
take real money, and it is built so that it cannot pretend otherwise — see
[Honest status](#honest-status).

---

## Run it

```bash
npm install
npm run setup        # generate client, create the database, seed fixtures
npm run dev          # http://localhost:3000
npm run worker       # in a second terminal — required
```

The worker is not optional: provisioning, account syncing, payout submission and
reconciliation run there, so a customer's request never waits on an external
provider.

```bash
npm test             # 176 tests
npm run typecheck
npm run build
npm run db:reset     # wipe and reseed
```

### Seeded accounts

Password for every account: `demo-password-not-secret`

| Account | What it demonstrates |
|---|---|
| `owner@example.invalid` | Owner console, launch gate, sensitivity calculator |
| `finance@example.invalid` | Payout queue |
| `trader.eligible@example.invalid` | Exactly $52,500 — the worked example, $500 gross available |
| `trader.justbelow@example.invalid` | $52,499 — one dollar short, payout unavailable |
| `trader.breached@example.invalid` | Trailing threshold hit, access terminated |
| `trader.dailypaused@example.invalid` | Daily loss limit hit, paused until next session |
| `trader.stale@example.invalid` | Stale data blocking payouts |
| `trader.unknown@example.invalid` | Payment outcome unknown, awaiting reconciliation |
| `trader.vendorfail@example.invalid` | Paid, but the provider could not create the account |
| `trader.provisioning@example.invalid` | Queued for setup |
| `trader.lifetimecap@example.invalid` | $3,000 already paid out |

These are fixtures chosen to exercise boundaries. They are not business
statistics and nothing presents them as such.

---

## The accounting model

The single most important thing about this business, and the easiest to get
wrong:

- A simulated **gain** creates no cash revenue.
- A simulated **loss** creates no cash revenue and is **not** a company trading
  loss. The company never had that money.
- A **$500 gross withdrawal** reduces the simulated account by $500 and pays the
  trader **$250 in real cash**.
- The other **$250 is received by no one**. It is simulated balance that ceases
  to exist, and it is never revenue.

This is enforced structurally, not by convention: four separate append-only
ledgers, and the SIMULATION ledger physically cannot post to a cash or revenue
account. A paid reward produces three balanced entries and zero revenue entries,
asserted in `tests/ledger.test.ts`.

## How decisions are modelled

Every commercially material value carries its provenance — `CONFIRMED`,
`PROPOSED`, `EXTERNAL` or `UNRESOLVED` — and the application enforces it. A
PROPOSED development default renders in demo behind a banner and **blocks
production sale** of the affected plan.

The lifetime payout cap is the sharpest case. It is a three-way decision, not a
nullable number:

```ts
type LifetimeCapPolicy =
  | { kind: 'unresolved'; draftMinor: bigint; note: string }
  | { kind: 'approved-amount'; amountMinor: bigint; approvedBy: string; approvedAt: string }
  | { kind: 'approved-uncapped'; approvedBy: string; approvedAt: string; acknowledgement: string };
```

Reading an amount out of an `unresolved` cap **throws**. `NULL` can never
silently mean "approved, unlimited" — an unbounded per-account cash obligation
has to be something the owner affirmatively chose.

## Money

Integer minor units on `bigint`, everywhere: domain, database (`BigInt`
columns), API (strings), browser. Binary floating point never touches a balance.
Percentages are exact rationals (`mulRatio(25n, 100n)`, never `* 0.25`), which
is why all six published coupon prices come out exact and why
`$599 + $19 + $29 + $49` with the coupon is exactly `$522.00`.

`Money.halfExact()` throws rather than rounding, so the 50/50 split can never
produce a fractional cent on a real obligation.

## Layout

```
src/domain/      Pure TypeScript — no framework, no database, no I/O
  money/         Decimal-safe money and deterministic allocation
  config/        Requirement provenance and the lifetime-cap decision type
  catalog/       Plans and add-ons with per-field approval status
  pricing/       Quote engine, coupons, canonical hashing
  risk/          Trailing drawdown, daily loss, sessions/DST, exposure
  payout/        Eligibility, reservations, state machine
  ledger/        Chart of accounts, balanced append-only entries
  provisioning/  Account provisioning state machine
  economics/     Contribution and runoff modelling
src/server/      Config, persistence, auth, providers, services, jobs
src/app/         Next.js App Router
tests/           Vitest — unit and end-to-end against a real database
docs/            Specification, decisions, rules, capabilities, legal, ops
```

Rules live in `src/domain` as pure functions, so the same code backs the UI, the
API, the workers and the tests. No component re-implements a payout limit.

## Documentation

| Document | Contents |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | Current product requirements |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Confirmed vs proposed vs unresolved |
| [docs/PAYOUT_AND_RISK_RULES.md](docs/PAYOUT_AND_RISK_RULES.md) | Exact algorithms, event ordering, worked examples |
| [docs/TRADOVATE_CAPABILITIES.md](docs/TRADOVATE_CAPABILITIES.md) | What is verified (nothing) and how to verify it |
| [docs/LEGAL_REVIEW.md](docs/LEGAL_REVIEW.md) | Draft terms, missing fields, review status |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Incidents, retries, reconciliation, access control |
| [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md) | Everything standing between this and real customers |

---

## Honest status

### Works locally, end to end

Account selection and configuration · server-side pricing and coupons ·
agreement signing bound to a quote hash · order creation · simulated payment ·
account provisioning with risk verification · risk ingestion, breach detection
and enforcement requests · payout eligibility, reservation, deduction and
ledger posting · trader dashboard · admin console with an enforced launch gate ·
sensitivity calculator · CSV export · signed-document download.

### Mocked, and labelled as mocked

| Integration | Status |
|---|---|
| Trading provider (Tradovate) | **Mock.** Every real capability is `UNVERIFIED` and the real adapter throws. |
| Payments | **Mock.** Moves no money. |
| Cash payout rail | **None.** The simulated deduction is applied, then the request parks for an operator. |
| Email | **Local outbox.** Nothing is sent. |
| Identity verification | **Not configured.** Status is `NOT_CONFIGURED`, never a fabricated `VERIFIED`. |

Production refuses to boot with any of these unconfigured. There is no mock
fallback in production.

### Not built

Real Tradovate calls · a real payment adapter · a cash payout rail · SMTP ·
password reset (needs email) · approved legal documents · tax configuration.

### Decisions still needed from the owner

1. **Lifetime cash payout cap per plan** — the largest open financial exposure.
2. Approval of every proposed risk parameter across all six plans.
3. The $75,000 and $300,000 position ceilings.
4. Refunds, geographic eligibility, prohibited conduct, tax treatment.
5. Company legal identity and contact details.

Full list in [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md), enforced live
at `/admin`.

**Nothing here is launch-ready. Mock provisioning, draft disclosures and
unverified integrations are exactly that, and the application will not let them
be sold as anything else.**
