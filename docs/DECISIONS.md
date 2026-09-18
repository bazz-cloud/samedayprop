# Decision register

Status of every commercially material requirement. This file is the human
counterpart to the machine-readable statuses in
`src/domain/config/requirement-status.ts` and `src/domain/catalog/plans.ts`,
which the application enforces at runtime.

| Status | Meaning | Effect in the application |
|---|---|---|
| **CONFIRMED** | The owner has committed to this. | Sellable in production. |
| **PROPOSED** | A development default. | Usable in demo mode behind a banner. **Blocks production sale** of any affected plan. |
| **EXTERNAL** | Depends on a third party. | Blocks the capability it gates until verified. |
| **UNRESOLVED** | The owner must actively decide. | Never defaulted. **Blocks production sale.** |

`planLaunchBlockers()` turns this table into an enforceable gate. The admin
console at `/admin` renders the live version.

---

## CONFIRMED

These came directly from the brief and are treated as commitments.

| Requirement | Value |
|---|---|
| Evaluation phase | None. No evaluation profit target. |
| Consistency rule | None. No best-day concentration test. |
| Minimum trading days | None. No minimum winning days. |
| Same-day eligibility | Available, including the first trading day, if all other published requirements are met. |
| Account type | Simulated funded accounts. |
| Trader share | 50% of eligible rewards. |
| Retained profit buffer | Required before payouts. Amount per plan is PROPOSED. |
| Drawdown type | Intraday trailing, following equity through the day including unrealized gains. |
| Daily loss limit | Exists, account-size dependent. Amount per plan is PROPOSED. |
| Cost treatment | Net trading results account for commissions and trading fees. |
| Minimum withdrawal | $500 GROSS, paying $250 CASH. |
| Starting daily cash cap | $1,000 ($2,000 gross) on the $25K account. |
| Billing | One-time purchase. Not a subscription, no automatic renewal. |
| Coupon | 25% off the account and all selected eligible add-ons. |
| Account sizes and list prices | Six sizes at $349 / $599 / $799 / $999 / $1,499 / $2,499. |
| Position ceilings | $25K: 2 minis / 20 micros. $50K: 4 / 40. $100K: 6 / 60. $150K: 10 / 100. |
| Platform | Tradovate is the planned platform (capability verification is EXTERNAL). |
| Checkout | Signed trader agreements required before payment and activation. |

### Confirmed price table

| Account | List price | After 25% coupon |
|---|---:|---:|
| $25,000 | $349.00 | $261.75 |
| $50,000 | $599.00 | $449.25 |
| $75,000 | $799.00 | $599.25 |
| $100,000 | $999.00 | $749.25 |
| $150,000 | $1,499.00 | $1,124.25 |
| $300,000 | $2,499.00 | $1,874.25 |

Asserted exactly in `tests/pricing.test.ts`.

---

## PROPOSED — development defaults requiring commercial approval

**Every plan is currently blocked from production sale** because each carries at
least one PROPOSED risk parameter.

| Account | Drawdown allowance | Daily loss limit | Retained buffer | Daily cash cap |
|---|---:|---:|---:|---:|
| $25K | $1,000 | $400 | $1,000 | $1,000 *(confirmed)* |
| $50K | $2,000 | $700 | $2,000 | $1,500 |
| $75K | $2,500 | $900 | $2,500 | $2,000 |
| $100K | $3,000 | $1,000 | $3,000 | $2,500 |
| $150K | $4,500 | $1,500 | $4,500 | $3,000 |
| $300K | $7,500 | $2,500 | $7,500 | $4,000 |

Other proposed defaults:

| Item | Proposed value | Note |
|---|---|---|
| Trailing stop point | Starting balance + $100 | Configurable and versioned. |
| Daily loss consequence | Flatten positions, pause trading until next session | |
| Trailing breach consequence | Terminate trading access on that account | |
| Accounts per person | One active account per verified person, pilot only | |
| Overnight positions | Not permitted in the pilot | Session times need exchange-calendar approval. |
| Session boundary | 17:00 America/New_York | DST-correct; holiday calendar NOT yet approved. |
| Mini/micro conversion | 10 micro-equivalents per mini | Per-product controls required; equal dollar risk is never assumed. |
| Coupon code | `START25` | Name, validity window and use limits all configurable. |
| Gross withdrawal increment | $1.00 | Derived control: keeps the 50/50 split free of fractional cents. |
| Post-withdrawal room | $0.01 above the trailing threshold | Derived control: a payout must not be what trips a breach. |
| Add-on prices | $19 / $29 / $49 | Candidate products; none approved for sale. |
| Add-on unit costs | $0.50 / $3.00 / $25.00 | Assumptions for contribution reporting only. |

---

## UNRESOLVED — the owner must decide

### Lifetime cash payout caps — the largest open exposure

Recommended but **explicitly NOT approved**: $1,500 / $3,000 / $4,000 / $5,000 /
$6,000 / $10,000 for the six sizes.

These are seeded as `kind: 'unresolved'` drafts. The type system makes it
impossible to read a usable number out of an unresolved cap:
`lifetimeCapAmountMinor()` throws rather than returning `null`, and
`lifetimeCapForPayout()` throws in the service layer. A payout request on a plan
with an undecided cap is refused with an explanation, not silently processed as
uncapped.

**The owner must either approve an amount per plan, or explicitly approve an
uncapped policy with a written acknowledgement that the obligation is unbounded.**

### Position ceilings not finalised

| Account | Interpolated for development | Status |
|---|---|---|
| $75,000 | 5 minis / 50 micros | NOT finalised |
| $300,000 | 15 minis / 150 micros | NOT finalised |

### Policies with no default

Each is configurable and **none has been invented**. The application ships with
no restriction in place and no permission granted; the policy simply does not
exist yet.

- Automated trading systems and bots
- News trading
- Cross-account hedging
- Copy trading and trade mirroring
- Restricted countries and geographic eligibility
- Refunds and cancellation
- Account inactivity
- Account resets
- Prohibited conduct, suspension evidence standards and the appeal route
- Program completion and account closure

### Legal and tax

- Governing law and jurisdiction
- Dispute resolution, arbitration, class-action waiver
- Tax jurisdiction, rate, and inclusive/exclusive treatment
- Limitation of liability and indemnities
- Data retention periods and named sub-processors

### Company identity

Company name, legal entity, jurisdiction, postal address and support email are
all placeholders. Legal documents cannot be finalised and production cannot be
enabled until they are supplied.

---

## EXTERNAL — depends on a third party

| Dependency | Status | Blocks |
|---|---|---|
| Tradovate partner capabilities | Every capability UNVERIFIED | Account provisioning, risk enforcement, simulated balance adjustment. See `docs/TRADOVATE_CAPABILITIES.md`. |
| Payment provider | Not configured | Taking real money. |
| Cash payout rail | Not configured | Paying real rewards. |
| Identity verification provider | Not configured | Eligibility checks; `CustomerVerification.status` is `NOT_CONFIGURED`, never a fabricated `VERIFIED`. |
| Email provider | Not configured | All customer email. Demo writes to a local outbox. |
| Exchange/instrument calendar | Not approved | Session boundaries, holidays, per-product risk controls. |

---

## Derived controls introduced during implementation

These were not in the brief. They are documented here so they can be reviewed
rather than discovered later.

1. **Whole-dollar gross increment.** Cash is exactly half the gross, so an odd
   number of cents would produce a fractional cent on a real obligation.
   `Money.halfExact()` throws rather than rounding silently.
2. **Post-withdrawal room of $0.01.** Equity *touching* the trailing threshold
   is a breach, so a payout must leave equity strictly above it.
3. **Reservation attributed to the requesting session.** A request made on
   Monday keeps counting against Monday's cap even if it settles Wednesday,
   closing a day-hopping loophole.
4. **Unapproved instruments cannot be traded at all**, rather than defaulting to
   the equity-index risk weight.
5. **`active` reachable only from `risk_verified`.** A provisioning call that
   did not throw is not evidence that limits were applied.
