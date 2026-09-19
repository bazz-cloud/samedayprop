# Open items — things only you can do

Live list. Kept here rather than in chat so it survives the session.

Items are grouped by what blocks what. Nothing on this list is something I can
decide or build for you: each one needs a vendor account, a legal answer, a
commercial decision, or a credential I must never hold.

---

## 0. Decided 2026-09-19 — what changed

| Decision | Effect |
|---|---|
| Trailing threshold **never stops rising** | Replaces the $100 stop. Room above the threshold is now capped at the drawdown allowance, so one request can never reach the daily cash cap. Published on /payouts. |
| **Michigan sales tax, 6%** | Added to the discounted total. Two questions for your accountant are open, below. |
| Policies | **TBD** — still the only thing blocking a production sale. |
| **START25 confirmed** | Unlimited uses, no per-customer limit, no expiry. Not auto-applied; typed in at checkout. Effectively the price, so the stress model uses the discounted figure. |
| Add-ons replaced | Two risk upgrades — bigger daily loss limit, two more contracts — replacing the journal/analytics/setup candidates. **Prices are drafted and need your approval.** |
| Items 8–11 confirmed | Session boundary, whole-dollar increments, $0.01 post-withdrawal room, reset restores to starting balance. |
| **Add-on prices confirmed** | Flat $50 (bigger daily loss limit) and $30 (two more contracts), the same on every account size. Clears `ADDON_PRICE_PROPOSED`. |
| **Company identity** | Bull Rush Prop LLC, Michigan, admin@bullrushfutures.com. Postal address still outstanding. |

## 1. Blocks taking real money

| Item | Why it blocks | Status |
|---|---|---|
| **Add-on prices** — two risk upgrades, five plans each | Drafted at $49–$249 (daily loss uplift) and $69–$329 (two contracts), scaling with account size. PROPOSED, so any order containing one is blocked from production sale. |
| **Sales tax: is this fee taxable in Michigan?** | Michigan taxes tangible property and prewritten software delivered electronically, not most services. An accountant has to answer it; the 6% is being charged meanwhile. |
| **Sales tax: destination or origin?** | Sales tax is normally destination-based. We charge 6% to every buyer regardless of state, as instructed. Switching needs only the buyer's region, which the profile already stores. |
| **Postal address** — the only company field still missing | Supplied 2026-09-19: Bull Rush Prop LLC, Michigan, admin@bullrushfutures.com. The address was given as "no address", so it is deliberately left unset and the launch gate still reports the company as incomplete. Your Michigan LLC filing carries a registered office address; that is the one the agreements need. |
| **Company legal details** — entity name, jurisdiction, registered address, support email | Agreements have no counterparty on them. Also blocks governing law, arbitration and tax clauses, which all depend on jurisdiction. | Not started |
| **Payment provider** | No hosted checkout. `PAYMENTS_*` blank selects the mock; setting them selects an adapter that is not implemented and throws by design. | Not started |
| **Cash payout rail** | Nothing can pay a trader. The console produces a payout instruction; a human executes it somewhere. | Not started |
| **Identity verification provider** | `CustomerVerification.status` is `NOT_CONFIGURED`, never a fabricated `VERIFIED`. Required before a first payout under the drafted eligibility policy. | Not started |
| **Restricted-country list** | A legal determination (sanctions, licensing). `RESTRICTED_COUNTRIES` is UNRESOLVED and empty — it blocks nobody and is NOT evidence any country was cleared. | Needs counsel |

## 2. Trading platform

| Item | Notes |
|---|---|
| **Tradovate partner agreement** | Researched 2026-09-19 — see `docs/PLATFORM_INTEGRATION.md`. Register as a partner for an API key, pass conformance, beta test the production key a week. Every capability stays UNVERIFIED until a real call is made. **Decided 2026-09-19:** the trader signs Tradovate's market data agreement inside Tradovate on first sign-in. The site says so before and after purchase, and the status page carries it as a step we never mark done. |
| **Rithmic** | Bigger than a dropdown, and the research says why. Rithmic does not open accounts — a broker or FCM does, and issues the credentials. R \| API+ is a C++/.NET library, so it cannot be called from this app at all; it needs a separate service in a supported language, plus an FCM relationship and passed conformance. Marked UNSUPPORTED, not UNVERIFIED, for account creation. |
| **Which platform to launch with** | Tradovate is weeks of integration. Rithmic is a separate service and an FCM. Launching Tradovate-only and adding Rithmic later is the cheaper order, and the checkout already stores the choice per order either way. |
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

## 5a. Consequences of the no-stop trailing rule

Not decisions — arithmetic, listed so they are not discovered later.

- **The daily cash cap is unreachable in a single request on every tier.** Room
  above the threshold is at most the drawdown allowance, so one request can pay
  at most $449.50 / $899.50 / $1,349.50 / $2,024.50 / $3,374.50 against caps of
  $1,000 / $1,500 / $2,500 / $3,000 / $4,000. Reaching the cap takes several
  requests with new profit between them. /payouts states this.
- **A full withdrawal leaves the account at the edge.** Taking all available room
  leaves equity just above the threshold until the trader trades back up. If you
  want a cushion instead, the lever is `MIN_POST_WITHDRAWAL_ROOM` — currently
  $0.01, which you approved.
- **Optional:** lowering the published daily cash caps to match what is actually
  payable would remove the gap between the advertised cap and the reachable one.
  I have NOT done this; the cap is a ceiling, not a promise, and the page now
  explains the binding constraint.

## 6. Decided, no action needed

Recorded so they are not reopened by accident.

- Lifetime cash cap — 6× the daily cash cap. Reset does not restore capacity.
- Risk table — daily loss, drawdown, buffer and daily cash caps, all approved.
- $300,000 position ceiling — 15 minis / 150 micros.
- Ten trading and account policies — drafted; three need counsel on wording.
- Trailing threshold never stops rising. Approved 2026-09-19.
- Michigan sales tax 6%, on the discounted total. Approved 2026-09-19.
- START25: 25%, unlimited, no expiry, typed in at checkout. Approved 2026-09-19.
- Session boundary 17:00 America/New_York; whole-dollar gross withdrawals;
  $0.01 of post-withdrawal room; a reset restores the starting balance.
- A reset does NOT reopen an account that reached its lifetime cap.

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
- **Deploys were failing on schema changes, and now are not.** Renaming a column
  made `prisma db push` refuse ("use --accept-data-loss"), which failed the
  build, so Vercel kept serving the last good deployment while every push looked
  successful in git. `scripts/db-push.mjs` now follows APP_MODE the way the seed
  does: DEMO accepts the loss automatically (the build reseeds that database
  anyway), and SANDBOX or PRODUCTION still refuse unless `ALLOW_DB_DATA_LOSS=1`
  is set deliberately. When you move off DEMO, expect to set that variable for
  any deploy that drops a column — or move to real Prisma migrations, which is
  the better answer once there is customer data to lose.
- **No holiday calendar.** The session boundary is approved, but exchange
  holidays and per-instrument schedules are not loaded, so session dates are
  wrong on a holiday. Needs the exchange calendar.
- **"Traded at least once"** in the funnel is derived from the trade table. Once
  a real provider feeds snapshots but not fills, that figure will understate.
