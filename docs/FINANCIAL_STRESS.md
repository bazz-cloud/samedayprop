# Financial stress analysis

> GENERATED. Re-run `npx tsx scripts/stress-report.mjs` after any price, cap or limit change.

Prices are the START25 price, since that is what almost everyone pays.

## The shape of the risk

Revenue is a one-time fee. The liability against it is contingent, uncapped in
time, and between 13x and 23x the fee. Nothing about a discount changes the
second number — only the first.

| Account | Price paid | Lifetime cap | Exposure ratio |
|---|---:|---:|---:|
| $25,000 | $262 | $6,000 | **22.9x** |
| $50,000 | $449 | $9,000 | **20.0x** |
| $100,000 | $749 | $15,000 | **20.0x** |
| $150,000 | $1,124 | $18,000 | **16.0x** |
| $300,000 | $1,874 | $24,000 | **12.8x** |

## Break-even payout rates

The rate at which a cohort stops making money, computed exactly from price
and cap. Two bounds, because "a paying account" spans a 24x range:

| Account | Break-even if payers take the full cap | Break-even if payers take only the $250 minimum |
|---|---:|---:|
| $25,000 | 4.4% | 100.0% |
| $50,000 | 5.0% | 100.0% |
| $100,000 | 5.0% | 100.0% |
| $150,000 | 6.2% | 100.0% |
| $300,000 | 7.8% | 100.0% |

Industry reference: **7.0%** of funded accounts ever receive a payout
(quantvps.com/blog/prop-firm-statistics, tradersyard.com (2026)).

Read that against the left column. Break-even at full utilisation ranges from
4.4% to 7.8%. **4 of 5 tiers break even BELOW the
7.0% industry payout rate** ($25,000, $50,000, $100,000, $150,000), meaning that at
full cap utilisation those tiers lose money at the industry norm.
$300,000 clears it, because price rises faster than
their cap does — the exposure ratio falls as the tier grows.

The right column is the other extreme and is comfortable everywhere: if payers
take one minimum withdrawal and stop, break-even needs essentially everyone to
pay out. Reality sits between, and **where it sits is the single number that
decides whether this works.**

## Scenarios, per 100 accounts sold

### $25,000

| Scenario | Revenue | Payers | Cash out | Net | Margin |
|---|---:|---:|---:|---:|---:|
| Industry rate, light usage | $26,175 | 7 | $6,300 | $19,875 | 75.9% |
| Industry rate, half cap | $26,175 | 7 | $21,000 | $5,175 | 19.8% |
| Double industry rate, half cap | $26,175 | 14 | $42,000 | **$-15,825** | -60.5% |
| Triple industry rate, half cap | $26,175 | 21 | $63,000 | **$-36,825** | -140.7% |
| Industry rate, full cap | $26,175 | 7 | $42,000 | **$-15,825** | -60.5% |
| Double rate, full cap | $26,175 | 14 | $84,000 | **$-57,825** | -220.9% |
| Severe: 1 in 4 pays, full cap | $26,175 | 25 | $150,000 | **$-123,825** | -473.1% |

### $50,000

| Scenario | Revenue | Payers | Cash out | Net | Margin |
|---|---:|---:|---:|---:|---:|
| Industry rate, light usage | $44,925 | 7 | $9,450 | $35,475 | 79.0% |
| Industry rate, half cap | $44,925 | 7 | $31,500 | $13,425 | 29.9% |
| Double industry rate, half cap | $44,925 | 14 | $63,000 | **$-18,075** | -40.2% |
| Triple industry rate, half cap | $44,925 | 21 | $94,500 | **$-49,575** | -110.4% |
| Industry rate, full cap | $44,925 | 7 | $63,000 | **$-18,075** | -40.2% |
| Double rate, full cap | $44,925 | 14 | $126,000 | **$-81,075** | -180.5% |
| Severe: 1 in 4 pays, full cap | $44,925 | 25 | $225,000 | **$-180,075** | -400.8% |

### $300,000

| Scenario | Revenue | Payers | Cash out | Net | Margin |
|---|---:|---:|---:|---:|---:|
| Industry rate, light usage | $187,425 | 7 | $25,200 | $162,225 | 86.6% |
| Industry rate, half cap | $187,425 | 7 | $84,000 | $103,425 | 55.2% |
| Double industry rate, half cap | $187,425 | 14 | $168,000 | $19,425 | 10.4% |
| Triple industry rate, half cap | $187,425 | 21 | $252,000 | **$-64,575** | -34.5% |
| Industry rate, full cap | $187,425 | 7 | $168,000 | $19,425 | 10.4% |
| Double rate, full cap | $187,425 | 14 | $336,000 | **$-148,575** | -79.3% |
| Severe: 1 in 4 pays, full cap | $187,425 | 25 | $600,000 | **$-412,575** | -220.1% |

## Correlated clusters

Correlated accounts are not independent draws. One trader running one idea
across five accounts pays out on all five or none, so the variance is far
larger than the account count suggests.

| Account | 5-account cluster revenue | Worst-case cash out | Net if it wins |
|---|---:|---:|---:|
| $25,000 | $1,309 | $30,000 | **$-28,691** |
| $50,000 | $2,246 | $45,000 | **$-42,754** |
| $100,000 | $3,746 | $75,000 | **$-71,254** |
| $150,000 | $5,621 | $90,000 | **$-84,379** |
| $300,000 | $9,371 | $120,000 | **$-110,629** |

## Our limits against the industry

This is the finding that most changes the picture, and it cuts both ways.

| Account | Our daily loss | Our drawdown | Industry drawdown | How much tighter |
|---|---:|---:|---:|---:|
| $25,000 | 1.4% | 3.6% | 6.5% | **1.8x** |
| $50,000 | 1.2% | 3.6% | 6.5% | **1.8x** |
| $100,000 | 0.9% | 2.7% | 6.5% | **2.4x** |
| $150,000 | 0.9% | 2.7% | 6.5% | **2.4x** |
| $300,000 | 0.7% | 2.3% | 6.5% | **2.9x** |

Our drawdown allowances are **1.8x to 2.9x tighter** than the instant-funding
midpoint of 6.5%, and our daily loss limits are roughly a third of the
4.0% norm. That has two consequences, and they point in opposite
directions.

**Financially, it is the thing that saves the model.** The break-even table
above says this business loses money at the industry payout rate IF payers
exhaust their caps. Tighter limits are precisely what stops them: with
70.0% of industry failures caused by drawdown rather than by missing a
target, halving the drawdown room should raise the blowup rate well above the
observed 62.0% within 45 days, and cap utilisation with it. The model does not
survive on the 50% profit split; it survives on accounts ending early.

**Commercially and reputationally, it is a liability.** The site sells
"no consistency, no evaluation, no minimum days" — genuinely generous on those
three axes — while running risk limits materially tighter than firms that
advertise the opposite. That is defensible only because every figure is
published up front, on the pricing page, in the rules and in the breach email.
It stops being defensible the moment the marketing implies the rules are loose.

It is also the number to watch after launch. If the observed blowup rate comes
in near the industry 62% rather than above it, the break-even table is the
real forecast and the tiers below $300,000 need either a higher price, a lower
cap, or both.

## What would actually hurt

In rough order of how much damage per unit of likelihood:

1. **A correlated cluster that wins.** Five $300,000 accounts cost one trader
   $9,371 and can claim $120,000. No payout rate assumption protects against
   this, because the accounts are not independent draws. The cluster detector
   exists for exactly this and should gate payouts, not just report.
2. **Cap utilisation above ~50%.** Every tier below $300,000 is loss-making at
   the industry payout rate once payers use half their cap. This is the
   assumption with no published source and the one worth instrumenting from
   day one.
3. **A discount deepening the ratio.** At half price the $25,000 tier reaches
   34.4x. The promotion engine blocks this without a typed override.
4. **Concentration in the $25,000 tier.** It has the worst exposure ratio and
   the lowest break-even. A promotion that sells mostly $25,000 accounts is
   worse than one that sells the same revenue across tiers.

Cash-flow timing is the one comfortable feature: revenue arrives in full at
purchase, payouts are paid out of it later, and a reset is revenue from an
account whose capacity is already partly spent. The business is solvent in
sequence even in scenarios where it is unprofitable in total — which is a
trap, because it can look fine on a bank balance while losing money.

## Sources

- **fundedAccountsReceivingPayout** — 7.0%. Share of funded accounts that ever receive a payout. _quantvps.com/blog/prop-firm-statistics, tradersyard.com (2026)_
- **consistentlyPaidTraders** — 1.5%. Traders who secure payouts consistently, 1-2%. Midpoint used. _phidiaspropfirm.com instant-funding analysis (2026)_
- **blownWithin45Days** — 62.0%. Instant-funding accounts blown within 45 days. _phidiaspropfirm.com (2026)_
- **failuresFromDrawdown** — 70.0%. Share of failures caused by hitting a drawdown limit rather than by missing a target. _quantvps.com/blog/prop-firm-statistics (2026)_
- **instantFundingDailyLossPct** — 4.0%. Typical instant-funding daily loss limit, 3-5% of account size. Midpoint. _phidiaspropfirm.com, fortraders.com (2026)_
- **instantFundingDrawdownPct** — 6.5%. Typical instant-funding max drawdown, 5-8% of account size. Midpoint. _phidiaspropfirm.com, fortraders.com (2026)_

These are comparison-site and blog aggregations, not audited filings. Prop
firms do not publish verified payout statistics. Reported figures disagree
with one another — 62% of accounts blown within 45 days in one source, 87%
within 30 days in another — and are kept separate rather than averaged,
because averaging two incompatible definitions produces a number that
measures nothing.
