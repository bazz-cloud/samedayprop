# Open items — things only you can do

Live list. Kept here rather than in chat so it survives the session.

Items are grouped by what blocks what. Nothing on this list is something I can
decide or build for you: each one needs a vendor account, a legal answer, a
commercial decision, or a credential I must never hold.

---

## 1. Blocks taking real money

| Item | Why it blocks | Status |
|---|---|---|
| **Company legal details** — entity name, jurisdiction, registered address, support email | Agreements have no counterparty on them. Also blocks governing law, arbitration and tax clauses, which all depend on jurisdiction. | Not started |
| **Payment provider** | No hosted checkout. `PAYMENTS_*` blank selects the mock; setting them selects an adapter that is not implemented and throws by design. | Not started |
| **Cash payout rail** | Nothing can pay a trader. The console produces a payout instruction; a human executes it somewhere. | Not started |
| **Identity verification provider** | `CustomerVerification.status` is `NOT_CONFIGURED`, never a fabricated `VERIFIED`. Required before a first payout under the drafted eligibility policy. | Not started |
| **Restricted-country list** | A legal determination (sanctions, licensing). `RESTRICTED_COUNTRIES` is UNRESOLVED and empty — it blocks nobody and is NOT evidence any country was cleared. | Needs counsel |

## 2. Trading platform

| Item | Notes |
|---|---|
| **Tradovate partner agreement** | Every capability is UNVERIFIED: creating accounts, applying and reading back risk limits, streaming authoritative equity, stopping trading on breach. See `docs/TRADOVATE_CAPABILITIES.md`. |
| **Rithmic** | Second platform, not yet scoped. Decide whether it is an alternative or a parallel offering — it changes the provisioning layer, the credential flow and the risk-ingest adapter, not just a dropdown. |
| **Automated credential issuance** | Depends on the platform partner. The show-once password mechanism is built; what is missing is the provider call that creates the account and returns an invitation. |
| **Which fills the provider sends** | The `Trade` model exists but nothing populates it from a real provider yet. The risk engine is snapshot-driven; trades need a fills feed. Without it the admin analytics run on seeded fixtures only. |

## 3. Email

No email provider is configured. Messages write to `.outbox/` and the
`EmailOutbox` table instead of sending. Templates needed:

- [ ] Account purchased — receipt, what they bought, the signed PDF
- [ ] Credentials issued — show-once, never a reusable password
- [ ] Account breached — which limit, the evidence, what the reset costs
- [ ] Payout requested — confirmation with the amount and the stage
- [ ] Payout paid — confirmation, not a promise of arrival time
- [ ] Daily-loss lockout — when trading reopens (Globex, 18:00 ET)
- [ ] Inactivity warnings at 60 and 83 days, per the drafted policy

Each one needs the sending identity from item 1 first, or mail misidentifies its
sender.

## 4. Infrastructure

| Item | Notes |
|---|---|
| **Production database** | Neon Postgres is attached for the demo. A separate database is required per mode — demo, sandbox and production must never share one. |
| **Backups and retention** | No policy set. Retention periods are also a legal question (item 1). |
| **2FA for admin accounts** | `mfaSecret` and `mfaEnabledAt` columns exist on `User` and the seed pre-enrols demo admins, but no enrolment or verification flow is built. Owner, finance, support and risk roles should not be reachable with a password alone. |
| **2FA for traders** | Decide whether it is optional or required before a first payout. |

## 5. Commercial decisions

| Item | Notes |
|---|---|
| **Trailing stop offset** | The last unapproved term on the public site. Currently starting balance + $100, marked PROPOSED. |
| **Discord for affiliate coupons** | Needs a decision on attribution: a code shared in a channel is not attributable to one referrer unless each affiliate gets their own. Also interacts with correlated-account risk — a cheap code in a trading server is how five-account copiers get assembled. |
| **Affiliate terms** | Payout rate, when it vests, whether it survives a refund or a chargeback. |

## 6. Decided, no action needed

Recorded so they are not reopened by accident.

- Lifetime cash cap — 6× the daily cash cap. Reset does not restore capacity.
- Risk table — daily loss, drawdown, buffer and daily cash caps, all approved.
- $300,000 position ceiling — 15 minis / 150 micros.
- Ten trading and account policies — drafted; three need counsel on wording.

---

## Known gaps in what I built

Not your to-do list — mine, or things that need a migration you should approve.

- **No IP address or device fingerprint** on orders or sessions. These are the
  two strongest same-owner signals, and their absence is why correlated-account
  detection is weaker than it should be. Needs a migration.
- **Catalog revisions must run on deploy.** `publishCatalogIfEmpty` skips a plan
  that already has a published version, so approving a cap or moving a risk
  figure in `plans.ts` never reached the database. `publishCatalogRevisions()`
  now publishes a new version when terms change and supersedes the old one;
  it runs in `vercel-build` and in the seed. If you change a commercial term,
  check the deploy log says it published a revision.
- **Seeded orders never post to the revenue ledger**, so firm net position reads
  $0 against $8,000 of paid orders. The admin console reports both sources and
  flags the disagreement rather than hiding it. Revenue posting belongs in
  provisioning, not only in live checkout.
- **"Traded at least once"** in the funnel is derived from the trade table. Once
  a real provider feeds snapshots but not fills, that figure will understate.
