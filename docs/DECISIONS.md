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
| Account sizes and list prices | Five sizes at $349 / $599 / $999 / $1,499 / $2,499. |
| Position ceilings | $25K: 2 minis / 20 micros. $50K: 4 / 40. $100K: 6 / 60. $150K: 10 / 100. |
| Platform | Tradovate is the planned platform (capability verification is EXTERNAL). |
| Checkout | Signed trader agreements required before payment and activation. |
| Lifetime cash payout cap | Six times the account's daily cash payout cap. Reaching it ends the account; a reset does not restore capacity, so continuing means buying a new account. |

### Confirmed price table

| Account | List price | After 25% coupon |
|---|---:|---:|
| $25,000 | $349.00 | $261.75 |
| $50,000 | $599.00 | $449.25 |
| $100,000 | $999.00 | $749.25 |
| $150,000 | $1,499.00 | $1,124.25 |
| $300,000 | $2,499.00 | $1,874.25 |

### Lifetime cash payout caps

Derived, not written down: `6 x daily cash payout cap`. The owner approved the
multiple, so the two figures cannot drift apart in a hand-edited table.

| Account | Daily cash cap | Lifetime cash cap |
|---|---|---|
| $25,000 | $1,000 | **$6,000** |
| $50,000 | $1,500 | **$9,000** |
| $100,000 | $2,500 | **$15,000** |
| $150,000 | $3,000 | **$18,000** |
| $300,000 | $4,000 | **$24,000** |

The daily cash cap is CONFIRMED only for the $25,000 account; the other four are
still PROPOSED, so those four lifetime caps inherit that status through their
multiplicand and remain blocked from production sale on that basis.

The `unresolved` branch of `LifetimeCapPolicy` is retained and still tested: a
plan added later with no approved cap must keep failing closed rather than
defaulting to uncapped.

Asserted exactly in `tests/pricing.test.ts`.

---

## PROPOSED — development defaults requiring commercial approval

**Every plan is currently blocked from production sale** because each carries at
least one PROPOSED risk parameter.

The $75,000 account was withdrawn by the owner. Its published plan version is
RETIRED rather than deleted, so any order that pointed at it still resolves to
the exact terms that were sold.

| Account | Max drawdown | Daily loss limit | Retained buffer | Daily cash cap |
|---|---:|---:|---:|---:|
| $25K | $900 | $340 | $1,000 | $1,000 *(confirmed)* |
| $50K | $1,800 | $595 | $2,000 | $1,500 |
| $100K | $2,700 | $850 | $3,000 | $2,500 |
| $150K | $4,050 | $1,275 | $4,500 | $3,000 |
| $300K | $6,750 | $2,125 | $7,500 | $4,000 |

Owner decision: daily loss limits were cut 15% and max drawdown 10% from the
earlier figures. Both land on whole dollars at every account size.

Other proposed defaults:

| Item | Proposed value | Note |
|---|---|---|
| Trailing stop point | Starting balance + $100 | Configurable and versioned. |
| Daily loss consequence | Flatten positions, lock trading until the Globex reopen at 18:00 ET | |
| Max drawdown breach | Terminate trading access on that account; a paid reset is the way back | |
| Accounts per person | One active account per verified person, pilot only | |
| Overnight positions | Not permitted in the pilot | Session times need exchange-calendar approval. |
| Session boundary | 17:00 America/New_York | DST-correct; holiday calendar NOT yet approved. |
| Mini/micro conversion | 10 micro-equivalents per mini | Per-product controls required; equal dollar risk is never assumed. |
| Coupon code | `START25` | Name, validity window and use limits all configurable. |
| Daily-loss lockout expiry | Globex reopen, 18:00 ET | An hour after the 17:00 session roll that refreshes the allowance. Weekend behaviour needs the approved exchange calendar. |
| Account reset price | Discounted price &minus; $10 | Confirmed by the owner. Priced against the coupon price, not list: against list it exceeded the coupon price, so a reset cost more than a new account. |
| Reset restores | Starting balance, high-water and threshold | Consumed lifetime payout capacity and payout history are NOT restored. |
| Gross withdrawal increment | $1.00 | Derived control: keeps the 50/50 split free of fractional cents. |
| Post-withdrawal room | $0.01 above the trailing threshold | Derived control: a payout must not be what trips a breach. |
| Add-on prices | $19 / $29 / $49 | Candidate products; none approved for sale. |
| Add-on unit costs | $0.50 / $3.00 / $25.00 | Assumptions for contribution reporting only. |

---

## UNRESOLVED — the owner must decide

### Position ceiling not finalised

| Account | Interpolated for development | Status |
|---|---|---|
| $300,000 | 15 minis / 150 micros | NOT finalised |

### Policies now drafted, awaiting approval

These ten had no default and no wording. They are now drafted in
`src/domain/policy/policies.ts`, rendered on `/rules#policies` behind a banner
saying they are not yet binding, and marked PROPOSED — so they still block
production sale until approved.

| Policy | Proposed stance |
|---|---|
| Automated trading systems | Execution aids allowed; fully autonomous systems need written approval; fill-model exploitation prohibited outright |
| News trading | Permitted, no blackout windows |
| Cross-account hedging | Prohibited |
| Copy trading and signal services | Following allowed; mirroring across accounts you do not own prohibited; coordinated groups treated as one position |
| Who can open an account | 18+, outside sanctioned jurisdictions, one account each, identity verified at payout with a full refund if verification fails |
| Refunds and cancellation | Full refund before credentials, or within 7 days with no trades; delivered once traded; full refund when the failure is ours |
| Inactive accounts | Closed after 90 days with no trades, warned at 60 and 83 |
| Resets | Available on an account that can no longer trade, unlimited, never restores payout capacity, refused at the lifetime cap |
| Prohibited conduct, evidence and appeals | Named conduct list, documented findings disclosed to the trader, 30-day appeal reviewed by an uninvolved person, answered in 10 business days |
| How an account ends | Cap reached, drawdown breached, closed by you, or closed by us; withdrawn plans do not retire paid accounts; 12 months of record access |

Three of them — eligibility, refunds, and the conduct/appeal process — are
marked `needsLegalReview`. Approving the commercial shape does not settle the
wording, and the sanctioned-country list is a legal determination that has not
been invented here.

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
