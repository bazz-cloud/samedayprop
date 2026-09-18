# Payout and risk rules

The exact algorithms, their event ordering, and the worked examples they are
tested against. Where this document and the code disagree, the code and its
tests are authoritative — `tests/risk.test.ts`, `tests/payout.test.ts` and
`tests/session.test.ts` assert everything below.

---

## 1. Money

All monetary values are **integer minor units (cents) on `bigint`**. Binary
floating point never touches a balance, a price, a limit or a payout anywhere in
the system — not in the domain, not in the database (`BigInt` columns), not in
the API (serialised as strings), not in the browser.

Percentages are exact rationals: a 25% discount is `mulRatio(25n, 100n)`, never
`* 0.25`. This is why all five published coupon prices come out exact.

Rounding is explicit at every site. `half-up` for customer-facing pricing,
`floor` when capping a payout (never round a limit up in the customer's favour
by accident), `ceil` for break-even counts.

`Money.halfExact()` **throws** rather than rounding. The 50/50 split must be
exact, so gross withdrawals are constrained to whole dollars, guaranteeing an
even number of cents.

## 2. Trading sessions

Session boundaries are wall-clock times in a named IANA zone, not fixed UTC
offsets. Default: **17:00 America/New_York**, PROPOSED pending an approved
exchange calendar.

A session is labelled by the date on which it **closes**. An event at or after
the boundary belongs to the next session date.

DST is handled explicitly and tested against both 2026 transitions:

| Session | Opens (UTC) | Closes (UTC) | Length |
|---|---|---|---|
| 2026-03-08 (spring forward) | 2026-03-07T22:00Z | 2026-03-08T21:00Z | **23h** |
| 2026-11-01 (fall back) | 2026-10-31T21:00Z | 2026-11-01T22:00Z | **25h** |

Every instant inside each maps to exactly one session date, so the daily loss
allowance resets exactly once — no double allowance in November, no truncated
one in March.

Ambiguous and non-existent wall times resolve by a stated policy: the
spring-forward gap resolves forward to the post-jump instant; the fall-back
overlap resolves to the first (pre-transition) occurrence.

## 3. Risk

### 3.1 Intraday trailing drawdown

```
S = starting simulated balance
D = drawdown allowance for the plan
H = highest observed authoritative equity, net of modelled costs, initially S
T = min(S + stopOffset, H − D)          stopOffset = $100 (PROPOSED)
```

- `H` rises on **unrealized** intraday peaks, not only on closed trades.
- Neither `H` nor `T` **ever decreases** — not after a trading loss, and not
  after a withdrawal. The code clamps `T` monotonically as well as deriving it
  from a monotonic `H`, so a future formula change cannot silently break this.
- A withdrawal reduces equity but does **not** move `T`, so it does reduce
  remaining room.
- Once `H − D` reaches `S + $100`, `T` stops rising.
- **Breach condition: `equity ≤ T`.** Touching the threshold is a breach, not
  only falling below it.

Worked example ($50K, D = $2,000):

| Event | Equity | H | T | Room |
|---|---:|---:|---:|---:|
| Open | 50,000 | 50,000 | 48,000 | 2,000 |
| Unrealized peak | 52,500 | 52,500 | **50,100** (capped) | 2,400 |
| Gives back | 50,100 | 52,500 | 50,100 | 0 |
| Withdraws $500 gross | 52,000 | 52,500 | 50,100 | **1,900** |

The last row is the example from the brief.

### 3.2 Daily loss limit

```
sessionTradingPnl = currentEquity − sessionStartEquity + withdrawalDeductions
dailyLossUsed     = max(0, −sessionTradingPnl)
breach            = dailyLossUsed ≥ dailyLossLimit
```

**Withdrawal deductions are excluded.** They reduce equity but are cashflow-like
adjustments, not trading losses. Without the `+ withdrawalDeductions` term, a
trader who withdrew $2,000 in the morning would be locked out of a flat,
profitable account.

Commissions and fees are already inside `currentEquity` and are **never
subtracted a second time**.

Consequence (PROPOSED): flatten positions, pause trading until the next session.
The pause lifts on the session roll; a trailing breach does not.

### 3.3 Position exposure

Contracts convert to **micro-equivalent units** at 10 per mini, so "4 minis or
40 micros" is one combined limit of 40 units, not two independent ones.

- **Working entry orders count**, alongside filled positions. Evaluated against
  the worst case including everything already working, so two concurrent
  submissions cannot both slip under the cap.
- **OCO/bracket sets are charged their largest leg only**, since one leg can fill.
- **Reduce-intent orders never reduce counted exposure.** An order that has not
  filled may never fill.
- **Netting happens only within a configured netting group.** Long ES and short
  NQ is 80 units of risk, not zero. Different instruments carry different dollar
  risk per contract.
- **An instrument absent from `ProductRiskConfig`, or present but unapproved,
  cannot be traded at all.** Equal dollar risk is never assumed.

### 3.4 Event ordering and data integrity

Every provider event is stored **raw and normalised** before it is applied, with
its provider sequence, source timestamp and receipt time.

- `UNIQUE(provider, tradingAccountId, sequence)` makes duplicates a no-op.
- A sequence at or below `lastSequence` is recorded with `ignoredReason` and not
  applied — out-of-order arrivals cannot rewind state.
- Data older than `STALENESS_THRESHOLD_MS` (90s) marks the account **stale**,
  which blocks payouts and new exposure and raises an alert.
- Provider unreachable also marks stale, rather than silently retrying against a
  number we cannot vouch for.

### 3.5 Enforcement is two-phase

A flatten or disable is **requested**, and separately **confirmed**. `RiskEvent`
stores `requestedAction` and `actionConfirmed`. An unconfirmed request produces
a CRITICAL event stating that external trading may still be possible and that
operations must verify manually. The system never reports positions as closed on
the strength of a request that was not acknowledged.

---

## 4. Payouts

### 4.1 What is actually being paid

Real **cash rewards calculated against simulated profits**. Not a withdrawal
from a funded cash brokerage balance. A $500 gross withdrawal:

- reduces the simulated account by $500 (simulated units),
- pays the trader $250 in real cash (company expense),
- and the other $250 **is received by no one**. It is not revenue.

### 4.2 Capacity

```
A = reconciled simulated balance (already net of commissions and fees)
S = starting simulated balance
B = retained profit buffer
C = remaining daily CASH capacity
L = remaining lifetime CASH capacity, only where a cap is APPROVED
T = current trailing threshold
R = minimum post-withdrawal room ($0.01)

Gmax = max(0, min(A − S − B, 2C, 2L, A − T − R))
       floored to the $1.00 gross increment

eligible when Gmax ≥ $500
cash = Gmax / 2      (exact; gross is always an even number of cents)
```

The `2L` bound is applied **only** when a cap has been approved. An UNRESOLVED
cap does not fall back to unlimited — it throws, and the request is refused with
an explanation.

There is **no minimum trading day, winning day, consistency or best-day term
anywhere in this calculation.** `PayoutContext` has no field for any of them.

Worked examples ($50K: S = 50,000, B = 2,000, C = 1,500):

| Balance | A−S−B | 2C | Gmax | Cash | Leaves | Outcome |
|---:|---:|---:|---:|---:|---:|---|
| 52,499 | 499 | 3,000 | 499 | — | — | **Unavailable**, below the $500 minimum |
| 52,500 | 500 | 3,000 | 500 | 250 | 52,000 | Minimum withdrawal available |
| 55,000 | 3,000 | 3,000 | 3,000 | 1,500 | 52,000 | Bound by the daily cash cap |
| 60,000 | 8,000 | 3,000 | 3,000 | 1,500 | 57,000 | Bound by the daily cash cap |

### 4.3 Reservations

Capacity is consumed **at request time, not at settlement**. This closes three
holes:

1. Two concurrent requests cannot each see the full daily cap — the reservation
   is taken inside the same transaction that re-reads existing reservations.
2. A slow-settling request cannot be joined by a second spending the same
   capacity.
3. A request made Monday keeps counting against **Monday's** cap even if it
   settles Wednesday, so cancel-and-retry across a session boundary gains
   nothing. The lifetime cap is charged regardless of session.

`ACTIVE` and `CONSUMED` reservations both count. Only `RELEASED` frees capacity,
and `releaseReservation()` **throws** if asked to release one already paid.

### 4.4 State machine

```
requested → reserved → validating → approved → submitted → paid
                    ↘ rejected   ↘ needs_reconciliation ↗
                    ↘ canceled
submitted → paid | failed | needs_reconciliation
failed → approved (retry) | needs_reconciliation | canceled
needs_reconciliation → paid | failed | canceled | approved
```

`paid`, `canceled` and `rejected` are terminal.

**`submitted → canceled` does not exist.** Once a payment may be in flight, the
only exits are a confirmed outcome or reconciliation.

### 4.5 The asymmetry that matters most

> **A simulated deduction is reversed only on a CONFIRMED non-payment.**

`mayReverseSimulatedDeduction(state, providerOutcomeConfirmed)`:

| State | Confirmed? | May reverse |
|---|---|---|
| `paid` | either | **no** |
| `needs_reconciliation` | either | **no** |
| `failed` | yes | yes |
| `failed` | no | **no** |
| `canceled` / `rejected` | — | yes |

An unknown outcome is **not a failure**. Reversing on "we didn't hear back" would
restore the simulated balance while the cash may already have landed in the
trader's bank — letting the same profit be withdrawn twice. So an unknown
outcome parks in `needs_reconciliation`, keeps the deduction applied, keeps the
capacity reserved, and waits for an authoritative provider lookup.

### 4.6 Saga ordering

1. Reserve capacity (transactional, internal).
2. Re-validate against **fresh** data — balance, flat status, staleness, breach.
3. Approve, and accrue the obligation in the OBLIGATION ledger.
4. **Deduct the simulated balance first.** It is the reversible side.
5. Then submit the cash payment.
6. On confirmed success: post SIMULATION, CASH and OBLIGATION entries, and
   convert the reservation to `CONSUMED`.

Paying cash before deducting would leave a trader paid twice if the deduction
then failed.

### 4.7 Preconditions

Flat positions, no working orders, account active, data not stale. A breach that
happens *after* a payout was validly earned does **not** silently void it
(`breachShouldCancelPayout()` returns `false`); it goes to review with a recorded
reason.

---

## 5. Ledgers

Four **separate, append-only** ledgers, each balancing to zero independently:

| Ledger | Denomination | Contents |
|---|---|---|
| `SIMULATION` | simulated units — **not money** | Simulated balance movements |
| `CASH` | real money | Fees received, rewards paid, refunds, processor fees |
| `OBLIGATION` | real money | Rewards owed, capacity reserved |
| `REVENUE` | real money | Fees earned, discounts, costs of earning |

`assertBalanced()` rejects an entry whose lines cross ledgers.
`assertNoSimulatedRevenue()` rejects any attempt to post a simulated movement to
a cash or revenue account. Mixing them would make revenue appear to move with
trader P&L, which is false.

A paid reward posts **three** entries — SIMULATION $500, CASH $250, OBLIGATION
$250 — and **zero** revenue entries. Asserted in `tests/ledger.test.ts`.

Corrections are **compensating entries** referencing the original, never edits.
Every entry carries an idempotency key (UNIQUE), the actor, the reason, the
policy version and its references.
