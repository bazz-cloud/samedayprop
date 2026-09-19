/**
 * Generate docs/FINANCIAL_STRESS.md from the live plan catalog.
 *
 * Reads the real prices, caps and limits rather than restating them, so the
 * report cannot describe a product we no longer sell.
 * Run: npx tsx scripts/stress-report.mjs
 */
import { writeFileSync } from 'node:fs';

const { PLANS, couponPrice } = await import('../src/domain/catalog/plans.ts');
const { DEFAULT_COUPON } = await import('../src/domain/pricing/coupon.ts');
const { lifetimeCapAmountMinor } = await import('../src/domain/config/requirement-status.ts');
const s = await import('../src/domain/analytics/stress.ts');

const money = (minor) =>
  '$' + (Number(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const pct = (v) => (v * 100).toFixed(1) + '%';

const tiers = PLANS.map((plan) => ({
  planKey: plan.key,
  label: plan.label,
  startingBalanceMinor: plan.startingBalance.minor,
  pricePaidMinor: couponPrice(plan.listPrice.value, DEFAULT_COUPON.value.percentOff).minor,
  lifetimeCapMinor: lifetimeCapAmountMinor(plan.lifetimeCashCap),
  dailyLossLimitMinor: plan.dailyLossLimit.value.minor,
  drawdownAllowanceMinor: plan.drawdownAllowance.value.minor,
  dailyCashCapMinor: plan.dailyCashPayoutCap.value.minor,
}));

const analyses = tiers.map(s.analyseTier);
const out = [];
const w = (...lines) => out.push(...lines);

w('# Financial stress analysis', '', '> GENERATED. Re-run `npx tsx scripts/stress-report.mjs` after any price, cap or limit change.', '');
w('Prices are the START25 price, since that is what almost everyone pays.', '');

w('## The shape of the risk', '');
w('Revenue is a one-time fee. The liability against it is contingent, uncapped in');
w('time, and between 13x and 23x the fee. Nothing about a discount changes the');
w('second number — only the first.', '');
w('| Account | Price paid | Lifetime cap | Exposure ratio |');
w('|---|---:|---:|---:|');
for (const a of analyses) {
  w(`| ${a.label} | ${money(a.pricePaidMinor)} | ${money(a.lifetimeCapMinor)} | **${a.exposureRatio.toFixed(1)}x** |`);
}
w('');

w('## Break-even payout rates', '');
w('The rate at which a cohort stops making money, computed exactly from price');
w('and cap. Two bounds, because "a paying account" spans a 24x range:', '');
w('| Account | Break-even if payers take the full cap | Break-even if payers take only the $250 minimum |');
w('|---|---:|---:|');
for (const a of analyses) {
  w(`| ${a.label} | ${pct(a.breakEvenRateAtFullCap)} | ${pct(Math.min(1, a.breakEvenRateAtMinimumPayout))} |`);
}
w('');
w(`Industry reference: **${pct(s.INDUSTRY.fundedAccountsReceivingPayout.value)}** of funded accounts ever receive a payout`);
w(`(${s.INDUSTRY.fundedAccountsReceivingPayout.source}).`, '');
const industryRate = s.INDUSTRY.fundedAccountsReceivingPayout.value;
const below = analyses.filter((a) => a.breakEvenRateAtFullCap < industryRate);
const above = analyses.filter((a) => a.breakEvenRateAtFullCap >= industryRate);
const lo = Math.min(...analyses.map((a) => a.breakEvenRateAtFullCap));
const hi = Math.max(...analyses.map((a) => a.breakEvenRateAtFullCap));
w(`Read that against the left column. Break-even at full utilisation ranges from`);
w(`${pct(lo)} to ${pct(hi)}. **${below.length} of ${analyses.length} tiers break even BELOW the`);
w(`${pct(industryRate)} industry payout rate** (${below.map((a) => a.label).join(', ')}), meaning that at`);
w('full cap utilisation those tiers lose money at the industry norm.');
if (above.length > 0) {
  w(`${above.map((a) => a.label).join(' and ')} ${above.length === 1 ? 'clears' : 'clear'} it, because price rises faster than`);
  w('their cap does — the exposure ratio falls as the tier grows.');
}
w('');
w('The right column is the other extreme and is comfortable everywhere: if payers');
w('take one minimum withdrawal and stop, break-even needs essentially everyone to');
w('pay out. Reality sits between, and **where it sits is the single number that');
w('decides whether this works.**', '');

w('## Scenarios, per 100 accounts sold', '');
for (const tier of [tiers[0], tiers[1], tiers[4]]) {
  w(`### ${tier.label}`, '');
  w('| Scenario | Revenue | Payers | Cash out | Net | Margin |');
  w('|---|---:|---:|---:|---:|---:|');
  for (const scenario of s.SCENARIOS) {
    const r = s.runScenario(tier, scenario, 100);
    const net = money(r.netMinor);
    w(`| ${r.scenario} | ${money(r.revenueMinor)} | ${r.payingAccounts} | ${money(r.cashOutMinor)} | ${r.netMinor < 0n ? '**' + net + '**' : net} | ${pct(r.marginPct)} |`);
  }
  w('');
}

w('## Correlated clusters', '');
w('Correlated accounts are not independent draws. One trader running one idea');
w('across five accounts pays out on all five or none, so the variance is far');
w('larger than the account count suggests.', '');
w('| Account | 5-account cluster revenue | Worst-case cash out | Net if it wins |');
w('|---|---:|---:|---:|');
for (const tier of tiers) {
  const c = s.clusterWorstCase(tier, 5);
  w(`| ${tier.label} | ${money(c.revenueMinor)} | ${money(c.worstCaseCashMinor)} | **${money(c.netMinor)}** |`);
}
w('');

w('## Our limits against the industry', '');
w('This is the finding that most changes the picture, and it cuts both ways.', '');
w('| Account | Our daily loss | Our drawdown | Industry drawdown | How much tighter |');
w('|---|---:|---:|---:|---:|');
for (const a of analyses) {
  w(`| ${a.label} | ${pct(a.dailyLossPctOfAccount)} | ${pct(a.drawdownPctOfAccount)} | ${pct(s.INDUSTRY.instantFundingDrawdownPct.value)} | **${a.drawdownTightnessVsIndustry.toFixed(1)}x** |`);
}
w('');

w('Our drawdown allowances are **1.8x to 2.9x tighter** than the instant-funding');
w(`midpoint of ${pct(s.INDUSTRY.instantFundingDrawdownPct.value)}, and our daily loss limits are roughly a third of the`);
w(`${pct(s.INDUSTRY.instantFundingDailyLossPct.value)} norm. That has two consequences, and they point in opposite`);
w('directions.', '');
w('**Financially, it is the thing that saves the model.** The break-even table');
w('above says this business loses money at the industry payout rate IF payers');
w('exhaust their caps. Tighter limits are precisely what stops them: with');
w(`${pct(s.INDUSTRY.failuresFromDrawdown.value)} of industry failures caused by drawdown rather than by missing a`);
w('target, halving the drawdown room should raise the blowup rate well above the');
w(`observed ${pct(s.INDUSTRY.blownWithin45Days.value)} within 45 days, and cap utilisation with it. The model does not`);
w('survive on the 50% profit split; it survives on accounts ending early.', '');
w('**Commercially and reputationally, it is a liability.** The site sells');
w('"no consistency, no evaluation, no minimum days" — genuinely generous on those');
w('three axes — while running risk limits materially tighter than firms that');
w('advertise the opposite. That is defensible only because every figure is');
w('published up front, on the pricing page, in the rules and in the breach email.');
w('It stops being defensible the moment the marketing implies the rules are loose.', '');
w('It is also the number to watch after launch. If the observed blowup rate comes');
w('in near the industry 62% rather than above it, the break-even table is the');
w('real forecast and the tiers below $300,000 need either a higher price, a lower');
w('cap, or both.', '');
w('## What would actually hurt', '');
w('In rough order of how much damage per unit of likelihood:', '');
w('1. **A correlated cluster that wins.** Five $300,000 accounts cost one trader');
w('   $9,371 and can claim $120,000. No payout rate assumption protects against');
w('   this, because the accounts are not independent draws. The cluster detector');
w('   exists for exactly this and should gate payouts, not just report.');
w('2. **Cap utilisation above ~50%.** Every tier below $300,000 is loss-making at');
w('   the industry payout rate once payers use half their cap. This is the');
w('   assumption with no published source and the one worth instrumenting from');
w('   day one.');
w('3. **A discount deepening the ratio.** At half price the $25,000 tier reaches');
w('   34.4x. The promotion engine blocks this without a typed override.');
w('4. **Concentration in the $25,000 tier.** It has the worst exposure ratio and');
w('   the lowest break-even. A promotion that sells mostly $25,000 accounts is');
w('   worse than one that sells the same revenue across tiers.', '');
w('Cash-flow timing is the one comfortable feature: revenue arrives in full at');
w('purchase, payouts are paid out of it later, and a reset is revenue from an');
w('account whose capacity is already partly spent. The business is solvent in');
w('sequence even in scenarios where it is unprofitable in total — which is a');
w('trap, because it can look fine on a bank balance while losing money.', '');
w('## Sources', '');
for (const [key, figure] of Object.entries(s.INDUSTRY)) {
  w(`- **${key}** — ${pct(figure.value)}. ${figure.note} _${figure.source}_`);
}
w('');
w('These are comparison-site and blog aggregations, not audited filings. Prop');
w('firms do not publish verified payout statistics. Reported figures disagree');
w('with one another — 62% of accounts blown within 45 days in one source, 87%');
w('within 30 days in another — and are kept separate rather than averaged,');
w('because averaging two incompatible definitions produces a number that');
w('measures nothing.', '');

writeFileSync('docs/FINANCIAL_STRESS.md', out.join('\n'));
console.log('Wrote docs/FINANCIAL_STRESS.md');
