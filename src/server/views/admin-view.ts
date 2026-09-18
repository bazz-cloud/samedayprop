/**
 * Owner/admin view model.
 *
 * Reports what actually happened in real cash, and keeps simulated figures
 * clearly separated from it. Two rules this file enforces:
 *
 *  1. Revenue means fees actually collected. Simulated trading results never
 *     appear in a revenue figure.
 *  2. Active accounts that have not paid out are NOT treated as proven
 *     zero-payout outcomes. Their expected obligation is reported as an
 *     outstanding exposure.
 */

import { prisma } from '@/server/db';
import { Money } from '@/domain/money/money';
import { serialiseMoney, type SerialisedMoney } from '@/server/money-mapper';
import { accountBalances, verifyLedgersBalance } from '@/server/services/ledger-service';
import { getConfig, staticLaunchBlockers } from '@/server/config';
import { PLANS, planLaunchBlockers } from '@/domain/catalog/plans';
import { getTradingProvider } from '@/server/providers/registry';
import { unverifiedLaunchCapabilities } from '@/server/providers/trading/types';

export interface LaunchReadiness {
  readonly ready: boolean;
  readonly groups: {
    area: string;
    blockers: { detail: string; blocking: boolean }[];
  }[];
  readonly blockingCount: number;
}

export async function getLaunchReadiness(): Promise<LaunchReadiness> {
  const config = getConfig();
  const groups: LaunchReadiness['groups'] = [];

  const infrastructure = staticLaunchBlockers(config);
  if (infrastructure.length > 0) {
    groups.push({
      area: 'Providers and company details',
      blockers: infrastructure.map((b) => ({ detail: `${b.area}: ${b.detail}`, blocking: b.blocking })),
    });
  }

  // Trading provider capabilities.
  const provider = getTradingProvider();
  const unverified = unverifiedLaunchCapabilities(provider);
  if (unverified.length > 0) {
    groups.push({
      area: 'Trading provider capabilities',
      blockers: unverified.map((c) => ({
        detail:
          `${c.capability} is ${c.support}. It must be confirmed against current official ` +
          'documentation and the partner agreement, with evidence recorded in ' +
          'docs/TRADOVATE_CAPABILITIES.md.',
        blocking: true,
      })),
    });
  }

  // Commercial terms, per plan.
  const planBlockers: { detail: string; blocking: boolean }[] = [];
  for (const plan of PLANS) {
    for (const blocker of planLaunchBlockers(plan)) {
      planBlockers.push({ detail: `${plan.label} — ${blocker.field}: ${blocker.detail}`, blocking: true });
    }
  }
  if (planBlockers.length > 0) {
    groups.push({ area: 'Commercial terms awaiting approval', blockers: planBlockers });
  }

  // Legal documents.
  const drafts = await prisma.legalDocumentVersion.findMany({
    where: { requiredAtCheckout: true, status: 'DRAFT_PENDING_LEGAL_REVIEW' },
  });
  if (drafts.length > 0) {
    groups.push({
      area: 'Legal documents',
      blockers: drafts.map((d) => ({
        detail: `${d.title} (v${d.version}) is a draft pending legal review.`,
        blocking: true,
      })),
    });
  }

  // Tax.
  groups.push({
    area: 'Tax',
    blockers: [
      {
        detail:
          'No tax jurisdiction, rate or inclusive/exclusive treatment has been configured. ' +
          'Displayed totals exclude any tax that may apply.',
        blocking: true,
      },
    ],
  });

  // Unapproved instruments.
  const unapprovedProducts = await prisma.productRiskConfig.findMany({ where: { approved: false } });
  if (unapprovedProducts.length > 0) {
    groups.push({
      area: 'Instrument risk controls',
      blockers: unapprovedProducts.map((p) => ({
        detail: `${p.symbol}: ${p.description}`,
        blocking: false,
      })),
    });
  }

  const blockingCount = groups.reduce(
    (total, group) => total + group.blockers.filter((b) => b.blocking).length,
    0,
  );

  return { ready: blockingCount === 0, groups, blockingCount };
}

export interface AdminOverview {
  readonly mode: string;
  readonly counts: {
    users: number;
    orders: number;
    activeAccounts: number;
    breachedAccounts: number;
    pausedAccounts: number;
    staleAccounts: number;
    provisioningStuck: number;
    payoutsPending: number;
    payoutsNeedingReconciliation: number;
    deadJobs: number;
  };
  readonly cash: {
    feesCollected: SerialisedMoney;
    discountsGiven: SerialisedMoney;
    processorFees: SerialisedMoney;
    rewardsPaid: SerialisedMoney;
    refundsPaid: SerialisedMoney;
    outstandingObligations: SerialisedMoney;
  };
  readonly ledgerIntegrity: { ledger: string; balanced: boolean; net: string }[];
  readonly alerts: { severity: string; message: string; href?: string }[];
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const config = getConfig();

  const [
    users,
    orders,
    activeAccounts,
    breachedAccounts,
    pausedAccounts,
    staleAccounts,
    provisioningStuck,
    payoutsPending,
    payoutsNeedingReconciliation,
    deadJobs,
    balances,
    ledgerIntegrity,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'TRADER' } }),
    prisma.order.count(),
    prisma.tradingAccount.count({ where: { tradingStatus: 'ACTIVE' } }),
    prisma.tradingAccount.count({ where: { tradingStatus: 'BREACHED' } }),
    prisma.tradingAccount.count({ where: { tradingStatus: 'DAILY_PAUSED' } }),
    prisma.tradingAccount.count({ where: { dataStale: true } }),
    prisma.provisioningJob.count({
      where: { state: { in: ['manual_review', 'provisioning_failed_retryable'] } },
    }),
    prisma.payoutRequest.count({
      where: { state: { in: ['requested', 'reserved', 'validating', 'approved', 'submitted'] } },
    }),
    prisma.payoutRequest.count({ where: { state: 'needs_reconciliation' } }),
    prisma.job.count({ where: { status: 'DEAD' } }),
    accountBalances(),
    verifyLedgersBalance(),
  ]);

  const balanceFor = (account: string): Money => {
    const found = balances.find((b) => b.account === account);
    if (!found) return Money.zero();
    // Credit-normal accounts read naturally as credits minus debits.
    return found.credits.gt(found.debits)
      ? found.credits.minus(found.debits)
      : found.debits.minus(found.credits);
  };

  const alerts: AdminOverview['alerts'] = [];
  if (payoutsNeedingReconciliation > 0) {
    alerts.push({
      severity: 'CRITICAL',
      message: `${payoutsNeedingReconciliation} payout(s) have an unresolved payment outcome. The simulated deduction stays applied and capacity stays reserved until the provider confirms.`,
      href: '/admin/payouts',
    });
  }
  if (provisioningStuck > 0) {
    alerts.push({
      severity: 'CRITICAL',
      message: `${provisioningStuck} paid order(s) have not been provisioned. Customers see a truthful pending state and are owed a resolution.`,
    });
  }
  if (staleAccounts > 0) {
    alerts.push({
      severity: 'WARNING',
      message: `${staleAccounts} account(s) have stale authoritative data. Payouts and new exposure are blocked on them.`,
    });
  }
  if (deadJobs > 0) {
    alerts.push({
      severity: 'WARNING',
      message: `${deadJobs} background job(s) exhausted their retries and need attention.`,
    });
  }
  for (const ledger of ledgerIntegrity) {
    if (!ledger.balanced) {
      alerts.push({
        severity: 'CRITICAL',
        message: `The ${ledger.ledger} ledger does not balance (net ${ledger.net.toDecimalString()}). An entry was written outside the ledger service.`,
      });
    }
  }

  return {
    mode: config.mode,
    counts: {
      users,
      orders,
      activeAccounts,
      breachedAccounts,
      pausedAccounts,
      staleAccounts,
      provisioningStuck,
      payoutsPending,
      payoutsNeedingReconciliation,
      deadJobs,
    },
    cash: {
      feesCollected: serialiseMoney(
        balanceFor('REVENUE_ACCOUNT_FEES').plus(balanceFor('REVENUE_ADDON_FEES')),
      ),
      discountsGiven: serialiseMoney(balanceFor('CONTRA_REVENUE_DISCOUNTS')),
      processorFees: serialiseMoney(balanceFor('CASH_PROCESSOR_FEES_PAID')),
      rewardsPaid: serialiseMoney(balanceFor('CASH_TRADER_REWARDS_PAID')),
      refundsPaid: serialiseMoney(balanceFor('CASH_REFUNDS_PAID')),
      outstandingObligations: serialiseMoney(balanceFor('OBLIGATION_REWARDS_PAYABLE')),
    },
    ledgerIntegrity: ledgerIntegrity.map((l) => ({
      ledger: l.ledger,
      balanced: l.balanced,
      net: l.net.toDecimalString(),
    })),
    alerts,
  };
}
