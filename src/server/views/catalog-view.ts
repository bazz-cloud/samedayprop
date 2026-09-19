/**
 * View model for the public account cards and rule panels.
 *
 * Everything the spec requires an account card to display is computed HERE, on
 * the server, from the trusted catalog — including the worked first-withdrawal
 * example. The browser renders these strings; it never derives a price, a limit
 * or an example from its own arithmetic.
 */

import { Money } from '@/domain/money/money';
import {
  GROSS_WITHDRAWAL_INCREMENT,
  MINIMUM_GROSS_WITHDRAWAL,
  MIN_POST_WITHDRAWAL_ROOM,
  PLANS,
  trailingStopFor,
  couponPrice,
  planLaunchBlockers,
  type PlanDefinition,
} from '@/domain/catalog/plans';
import { ADDONS } from '@/domain/catalog/addons';
import { DEFAULT_COUPON } from '@/domain/pricing/coupon';
import { serialiseMoney, type SerialisedMoney } from '@/server/money-mapper';
import {
  describeLifetimeCap,
  lifetimeCapBlocksProductionSale,
} from '@/domain/config/requirement-status';

export interface RuleLine {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  /** Shown as a caveat chip when the term is not commercially confirmed. */
  readonly status: string;
}

/**
 * A single number a buyer scans, with no prose.
 *
 * The buy pages carry these; the full explanations live on /rules. Someone
 * choosing an account size is comparing figures, and a paragraph beside each
 * one buries the figure they came for.
 */
export interface KeyFact {
  readonly label: string;
  readonly value: string;
  /** Shown as a caveat chip when the term is not commercially confirmed. */
  readonly status: string;
}

export interface PlanView {
  readonly key: string;
  readonly label: string;
  readonly startingBalance: SerialisedMoney;
  readonly listPrice: SerialisedMoney;
  readonly couponPrice: SerialisedMoney;
  readonly couponCode: string;
  readonly couponPercentOff: number;
  readonly positionCeiling: { minis: number; micros: number; status: string };
  readonly dailyLossLimit: SerialisedMoney;
  readonly drawdownAllowance: SerialisedMoney;
  readonly retainedBuffer: SerialisedMoney;
  readonly dailyCashCap: SerialisedMoney;
  readonly dailyGrossEquivalent: SerialisedMoney;
  readonly lifetimeCapDescription: string;
  readonly lifetimeCapResolved: boolean;
  /** Where the threshold stops rising, or null when it never stops. */
  readonly trailingStopAt: SerialisedMoney | null;
  /** Where the trailing floor STARTS: starting balance minus the allowance. */
  readonly initialThreshold: SerialisedMoney;
  /** The exact balance at which the first withdrawal becomes available. */
  readonly firstWithdrawalAt: SerialisedMoney;
  /**
   * The most a single request can ever pay in cash.
   *
   * With no stop on the trailing threshold, room above it never exceeds the
   * drawdown allowance, so the allowance — not the daily cash cap — is what
   * bounds one request. Published because a cap a trader cannot reach would
   * otherwise read as a promise.
   */
  readonly maxSingleWithdrawalGross: SerialisedMoney;
  readonly maxSingleWithdrawalCash: SerialisedMoney;
  readonly firstWithdrawalGross: SerialisedMoney;
  readonly firstWithdrawalCash: SerialisedMoney;
  readonly firstWithdrawalLeaves: SerialisedMoney;
  /**
   * A representative withdrawal for THIS account size, not the minimum one.
   *
   * The minimum ($500 gross / $250 cash) is the same on every plan, so showing
   * it on a $300,000 account made the largest product look like the smallest.
   * These figures scale with the account; `firstWithdrawal*` above still carry
   * the minimum, and both are shown.
   */
  readonly exampleWithdrawalAt: SerialisedMoney;
  readonly exampleWithdrawalGross: SerialisedMoney;
  readonly exampleWithdrawalCash: SerialisedMoney;
  readonly exampleWithdrawalLeaves: SerialisedMoney;
  /** True when the example above IS the minimum, i.e. on the smallest account. */
  readonly exampleIsMinimum: boolean;
  readonly keyFacts: readonly KeyFact[];
  readonly rules: readonly RuleLine[];
  readonly launchBlockers: readonly { field: string; status: string; detail: string }[];
  readonly sellable: boolean;
}

export interface AddOnView {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly listPrice: SerialisedMoney;
  readonly couponPrice: SerialisedMoney;
  readonly delivery: string;
  readonly requiresCapacityCheck: boolean;
  readonly status: string;
}

function buildPlanView(plan: PlanDefinition): PlanView {
  const coupon = DEFAULT_COUPON.value;
  const percent = coupon.percentOff;

  // The worked example: the exact balance at which $500 gross first becomes
  // available, and what it pays.
  const minimumGross = MINIMUM_GROSS_WITHDRAWAL.value;
  const firstWithdrawalAt = plan.startingBalance
    .plus(plan.retainedBuffer.value)
    .plus(minimumGross);
  const firstWithdrawalLeaves = firstWithdrawalAt.minus(minimumGross);

  // The ceiling one request can ever reach: the whole drawdown allowance is the
  // widest the room ever gets, and a withdrawal may not land ON the threshold,
  // so the last whole dollar is unreachable.
  const maxSingleWithdrawal = trailingStopFor(plan) === null
    ? plan.drawdownAllowance.value
        .minus(MIN_POST_WITHDRAWAL_ROOM.value)
        .floorToIncrement(GROSS_WITHDRAWAL_INCREMENT.value)
    : plan.dailyCashPayoutCap.value.timesInt(2);

  // The scaled example: 2% of the nominal account size, rounded down to a whole
  // $500 so it reads as a round number, floored at the published minimum and
  // capped at one day's gross capacity so the example is a withdrawal that could
  // actually be paid in a single day. On the $25,000 account this lands exactly
  // on the minimum, which is why `exampleIsMinimum` exists rather than a
  // hard-coded list of sizes.
  const exampleGross = Money.min(
    Money.max(
      plan.startingBalance.mulRatio(2n, 100n, 'floor').floorToIncrement(minimumGross),
      minimumGross,
    ),
    plan.dailyCashPayoutCap.value.timesInt(2),
    maxSingleWithdrawal,
  );
  const exampleWithdrawalAt = plan.startingBalance
    .plus(plan.retainedBuffer.value)
    .plus(exampleGross);
  const exampleWithdrawalLeaves = exampleWithdrawalAt.minus(exampleGross);


  const rules: RuleLine[] = [
    {
      label: 'Evaluation',
      value: 'None',
      detail:
        'There is no evaluation phase and no profit target to pass before you can trade or ' +
        'become eligible for a payout.',
      status: 'CONFIRMED',
    },
    {
      label: 'Consistency rule',
      value: 'None',
      detail:
        'There is no consistency rule and no best-day concentration test. A single good day ' +
        'does not disqualify a payout.',
      status: 'CONFIRMED',
    },
    {
      label: 'Minimum trading days',
      value: 'None',
      detail:
        'Payout eligibility can be reached on your first trading day if every other published ' +
        'requirement is met. There is no minimum number of trading days or winning days.',
      status: 'CONFIRMED',
    },
    {
      label: 'Maximum position size',
      value: `${plan.positionCeiling.value.minis} minis or ${plan.positionCeiling.value.micros} micros`,
      detail:
        `Minis and micros share one combined limit of ${plan.positionCeiling.value.micros} ` +
        'micro-equivalent units, counting ten micros per mini. Positions you already hold and ' +
        'working entry orders both count, so two orders cannot fill past the limit. Different ' +
        'instruments are not netted against each other.',
      status: plan.positionCeiling.status,
    },
    {
      label: 'Daily loss limit',
      value: plan.dailyLossLimit.value.format(),
      detail:
        'Measured on session trading results including unrealized profit and loss and modelled ' +
        'costs. Reaching it flattens your positions and locks trading until the market reopens ' +
        'at 18:00 ET, an hour after the session roll that refreshes your allowance. ' +
        'A withdrawal reduces your balance but is not counted as a trading loss.',
      status: plan.dailyLossLimit.status,
    },
    {
      label: 'Maximum drawdown (intraday trailing)',
      value: plan.drawdownAllowance.value.format(),
      detail:
        'Your threshold follows your highest observed equity through the day, INCLUDING ' +
        'unrealized gains on open positions. It never moves back down after a loss or a ' +
        'withdrawal, and it never stops rising: it keeps following your highest equity for as ' +
        'long as the account is open. Because of that, the room between your balance and your ' +
        `threshold is never more than ${plan.drawdownAllowance.value.format()}, and that room ` +
        'is also the most any one withdrawal can take. Equity touching the threshold is a ' +
        'maximum drawdown breach and ends trading access on this account.',
      status: plan.drawdownAllowance.status,
    },
    {
      label: 'Retained profit buffer',
      value: plan.retainedBuffer.value.format(),
      detail:
        'This amount stays in the simulated account. It is not a target you must hit; it ' +
        'determines when a withdrawal becomes available and how much. Your first ' +
        `${minimumGross.format()} gross withdrawal becomes available at a simulated balance of ` +
        `${firstWithdrawalAt.format()}.`,
      status: plan.retainedBuffer.status,
    },
    {
      label: 'Reward split',
      value: '50% to you',
      detail:
        `A ${minimumGross.format()} gross withdrawal reduces your simulated account by ` +
        `${minimumGross.format()} and pays you ${minimumGross.halfExact().format()} in real ` +
        'cash. The other half is not paid to anyone; it is simulated balance that ceases to exist.',
      status: 'CONFIRMED',
    },
    {
      label: 'Minimum withdrawal',
      value: `${minimumGross.format()} gross / ${minimumGross.halfExact().format()} cash`,
      detail: `Gross withdrawals are whole-dollar amounts of ${GROSS_WITHDRAWAL_INCREMENT.value.format()} or more.`,
      status: 'CONFIRMED',
    },
    {
      label: 'Daily cash payout cap',
      value: plan.dailyCashPayoutCap.value.format(),
      detail:
        `Equivalent to ${plan.dailyCashPayoutCap.value.timesInt(2).format()} gross per day. ` +
        'Capacity is reserved when you request, not when you are paid, so several requests ' +
        'share the same day.',
      status: plan.dailyCashPayoutCap.status,
    },
    {
      label: 'Lifetime cash payout cap',
      value: lifetimeCapBlocksProductionSale(plan.lifetimeCashCap)
        ? 'Not yet decided'
        : describeLifetimeCap(plan.lifetimeCashCap),
      detail: lifetimeCapBlocksProductionSale(plan.lifetimeCashCap)
        ? 'The owner has not decided whether this plan carries a lifetime cap. Accounts on ' +
          'this plan are not offered for sale until that decision is made and published.'
        : `${describeLifetimeCap(plan.lifetimeCashCap)} — six times this account's daily cash ` +
          'cap. Once an account has paid out that much in total it is finished: a reset restores ' +
          'the balance but not payout capacity, so continuing means buying a new account.',
      status: lifetimeCapBlocksProductionSale(plan.lifetimeCashCap) ? 'UNRESOLVED' : 'CONFIRMED',
    },
    {
      label: 'Costs',
      value: 'Commissions and fees are modelled',
      detail:
        'Your net trading results, your daily loss and your payout eligibility are all measured ' +
        'after commissions and trading fees. They are counted once, not deducted again at ' +
        'payout time.',
      status: 'PROPOSED',
    },
    {
      label: 'Platform access',
      value: 'Tradovate (planned)',
      detail:
        'Tradovate is the planned trading platform. Platform access depends on verified partner ' +
        'capabilities which have not yet been confirmed. No other platform is offered.',
      status: 'EXTERNAL',
    },
    {
      label: 'Billing',
      value: 'One-time purchase',
      detail: 'This is a single charge. It is not a subscription and nothing renews automatically.',
      status: 'CONFIRMED',
    },
  ];

  // The short form: six numbers, no sentences.
  const keyFacts: KeyFact[] = [
    {
      label: 'Max position',
      value: `${plan.positionCeiling.value.minis} minis / ${plan.positionCeiling.value.micros} micros`,
      status: plan.positionCeiling.status,
    },
    {
      label: 'Daily loss limit',
      value: plan.dailyLossLimit.value.format(),
      status: plan.dailyLossLimit.status,
    },
    {
      label: 'Max drawdown',
      value: `${plan.drawdownAllowance.value.format()} trailing`,
      status: plan.drawdownAllowance.status,
    },
    {
      label: 'Profit buffer',
      value: plan.retainedBuffer.value.format(),
      status: plan.retainedBuffer.status,
    },
    {
      label: 'Daily payout cap',
      value: plan.dailyCashPayoutCap.value.format(),
      status: plan.dailyCashPayoutCap.status,
    },
    { label: 'Your split', value: '50% in cash', status: 'CONFIRMED' },
  ];

  const blockers = planLaunchBlockers(plan);

  return {
    key: plan.key,
    label: plan.label,
    startingBalance: serialiseMoney(plan.startingBalance),
    listPrice: serialiseMoney(plan.listPrice.value),
    couponPrice: serialiseMoney(couponPrice(plan.listPrice.value, percent)),
    couponCode: coupon.code,
    couponPercentOff: Number(percent),
    positionCeiling: {
      minis: plan.positionCeiling.value.minis,
      micros: plan.positionCeiling.value.micros,
      status: plan.positionCeiling.status,
    },
    dailyLossLimit: serialiseMoney(plan.dailyLossLimit.value),
    drawdownAllowance: serialiseMoney(plan.drawdownAllowance.value),
    retainedBuffer: serialiseMoney(plan.retainedBuffer.value),
    dailyCashCap: serialiseMoney(plan.dailyCashPayoutCap.value),
    dailyGrossEquivalent: serialiseMoney(plan.dailyCashPayoutCap.value.timesInt(2)),
    lifetimeCapDescription: lifetimeCapBlocksProductionSale(plan.lifetimeCashCap)
      ? 'Not yet decided'
      : describeLifetimeCap(plan.lifetimeCashCap),
    lifetimeCapResolved: !lifetimeCapBlocksProductionSale(plan.lifetimeCashCap),
    trailingStopAt: (() => {
      const stop = trailingStopFor(plan);
      return stop === null ? null : serialiseMoney(stop);
    })(),
    initialThreshold: serialiseMoney(plan.startingBalance.minus(plan.drawdownAllowance.value)),
    firstWithdrawalAt: serialiseMoney(firstWithdrawalAt),
    maxSingleWithdrawalGross: serialiseMoney(maxSingleWithdrawal),
    maxSingleWithdrawalCash: serialiseMoney(maxSingleWithdrawal.halfExact()),
    firstWithdrawalGross: serialiseMoney(minimumGross),
    firstWithdrawalCash: serialiseMoney(minimumGross.halfExact()),
    firstWithdrawalLeaves: serialiseMoney(firstWithdrawalLeaves),
    exampleWithdrawalAt: serialiseMoney(exampleWithdrawalAt),
    exampleWithdrawalGross: serialiseMoney(exampleGross),
    exampleWithdrawalCash: serialiseMoney(exampleGross.halfExact()),
    exampleWithdrawalLeaves: serialiseMoney(exampleWithdrawalLeaves),
    exampleIsMinimum: exampleGross.equals(minimumGross),
    keyFacts,
    rules,
    launchBlockers: blockers,
    sellable: blockers.length === 0,
  };
}

export function getPlanViews(): PlanView[] {
  return PLANS.map(buildPlanView);
}

export function getAddOnViews(): AddOnView[] {
  const percent = DEFAULT_COUPON.value.percentOff;
  return ADDONS.map((addon) => ({
    key: addon.key,
    name: addon.name,
    description: addon.description,
    listPrice: serialiseMoney(addon.listPrice.value),
    couponPrice: serialiseMoney(couponPrice(addon.listPrice.value, percent)),
    delivery:
      addon.delivery.kind === 'download'
        ? 'Instant download. One-time purchase.'
        : addon.delivery.kind === 'timed-entitlement'
          ? `${addon.delivery.days} days of access. Does not auto-renew.`
          : `One scheduled ${addon.delivery.minutes}-minute session, subject to available slots.`,
    requiresCapacityCheck: addon.requiresCapacityCheck,
    status: addon.listPrice.status,
  }));
}

/** Money helper for pages that need a formatted figure from a minor string. */
export function formatMinor(minor: string): string {
  return Money.fromMinor(BigInt(minor)).format();
}
