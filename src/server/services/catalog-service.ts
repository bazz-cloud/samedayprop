/**
 * Publishing the code catalog into immutable PlanVersion rows.
 *
 * The domain catalog in src/domain/catalog is the editorial source; a published
 * PlanVersion is the contractual artifact. An order points at a PlanVersion,
 * never at the live catalog, so changing a price or a drawdown allowance
 * tomorrow cannot rewrite what someone bought today.
 *
 * Publishing is therefore append-only: an edited plan becomes version N+1 and
 * the previous version is retired, not mutated.
 */

import { prisma } from '@/server/db';
import { Money } from '@/domain/money/money';
import {
  PLANS,
  TRAILING_STOP_POLICY,
  trailingStopFor,
  planLaunchBlockers,
  type PlanDefinition,
  type PlanKey,
} from '@/domain/catalog/plans';
import { ADDONS } from '@/domain/catalog/addons';
import { lifetimeCapBlocksProductionSale } from '@/domain/config/requirement-status';

function requirementStatusMap(plan: PlanDefinition): Record<string, string> {
  return {
    listPrice: plan.listPrice.status,
    positionCeiling: plan.positionCeiling.status,
    drawdownAllowance: plan.drawdownAllowance.status,
    dailyLossLimit: plan.dailyLossLimit.status,
    retainedBuffer: plan.retainedBuffer.status,
    dailyCashPayoutCap: plan.dailyCashPayoutCap.status,
    lifetimeCashCap: lifetimeCapBlocksProductionSale(plan.lifetimeCashCap)
      ? 'UNRESOLVED'
      : 'CONFIRMED',
    trailingStopPolicy: TRAILING_STOP_POLICY.status,
  };
}

function lifetimeCapColumns(plan: PlanDefinition) {
  const cap = plan.lifetimeCashCap;
  switch (cap.kind) {
    case 'approved-amount':
      return {
        lifetimeCapKind: 'APPROVED_AMOUNT',
        lifetimeCapMinor: cap.amountMinor,
        lifetimeCapApprovedBy: cap.approvedBy,
        lifetimeCapApprovedAt: new Date(cap.approvedAt),
      };
    case 'approved-uncapped':
      return {
        lifetimeCapKind: 'APPROVED_UNCAPPED',
        lifetimeCapMinor: null,
        lifetimeCapApprovedBy: cap.approvedBy,
        lifetimeCapApprovedAt: new Date(cap.approvedAt),
      };
    case 'unresolved':
      return {
        // The draft figure is stored for modelling only, and the kind makes
        // clear it is not an approval.
        lifetimeCapKind: 'UNRESOLVED',
        lifetimeCapMinor: cap.draftMinor,
        lifetimeCapApprovedBy: null,
        lifetimeCapApprovedAt: null,
      };
  }
}

/**
 * Retire published plan versions whose plan is no longer in the code catalog.
 *
 * Withdrawing a plan from sale must not delete its version: an order already
 * pointing at it has to keep resolving to the exact terms that were sold. The
 * row is marked RETIRED instead, which removes it from the sale path while
 * leaving every historical contract intact.
 */
export async function retireWithdrawnPlans(): Promise<number> {
  const live = PLANS.map((p) => p.key);
  const result = await prisma.planVersion.updateMany({
    where: { status: 'PUBLISHED', planKey: { notIn: live } },
    data: { status: 'RETIRED', sellableInProduction: false },
  });
  return result.count;
}

/** Publish the current code catalog as version 1 if nothing is published yet. */
export async function publishCatalogIfEmpty(): Promise<{ plans: number; addons: number }> {
  let plans = 0;
  let addons = 0;

  await retireWithdrawnPlans();

  for (const plan of PLANS) {
    const existing = await prisma.planVersion.findFirst({
      where: { planKey: plan.key, status: 'PUBLISHED' },
    });
    if (existing) continue;

    const blockers = planLaunchBlockers(plan);
    await prisma.planVersion.create({
      data: {
        planKey: plan.key,
        version: 1,
        status: 'PUBLISHED',
        label: plan.label,
        startingBalanceMinor: plan.startingBalance.minor,
        listPriceMinor: plan.listPrice.value.minor,
        ceilingMinis: plan.positionCeiling.value.minis,
        ceilingMicros: plan.positionCeiling.value.micros,
        drawdownAllowanceMinor: plan.drawdownAllowance.value.minor,
        dailyLossLimitMinor: plan.dailyLossLimit.value.minor,
        retainedBufferMinor: plan.retainedBuffer.value.minor,
        dailyCashCapMinor: plan.dailyCashPayoutCap.value.minor,
        trailingStopAtMinor: trailingStopFor(plan)?.minor ?? null,
        ...lifetimeCapColumns(plan),
        requirementStatuses: JSON.stringify(requirementStatusMap(plan)),
        launchBlockers: JSON.stringify(blockers),
        sellableInProduction: blockers.length === 0,
        publishedAt: new Date(),
      },
    });
    plans += 1;
  }

  for (const addon of ADDONS) {
    const existing = await prisma.addOnVersion.findFirst({
      where: { addOnKey: addon.key, status: 'PUBLISHED' },
    });
    if (existing) continue;

    await prisma.addOnVersion.create({
      data: {
        addOnKey: addon.key,
        version: 1,
        name: addon.name,
        description: addon.description,
        listPriceMinor: addon.listPrice.value.minor,
        deliveryKind: addon.delivery.kind,
        deliveryDays: addon.delivery.kind === 'timed-entitlement' ? addon.delivery.days : null,
        deliveryMinutes:
          addon.delivery.kind === 'scheduled-session' ? addon.delivery.minutes : null,
        assumedUnitCostMinor: addon.assumedUnitCost.value.minor,
        requiresCapacityCheck: addon.requiresCapacityCheck,
        couponEligible: addon.couponEligible,
        status: 'PUBLISHED',
        // Every add-on is a candidate product; none is approved for sale.
        sellableInProduction: addon.listPrice.status === 'CONFIRMED',
      },
    });
    addons += 1;
  }

  return { plans, addons };
}

/**
 * The terms that define a plan version, for comparison.
 *
 * Anything a customer is sold on. Presentation-only fields are excluded: a
 * reworded label should not create a new contract version.
 */
function termsFingerprint(plan: PlanDefinition): string {
  const caps = lifetimeCapColumns(plan);
  return JSON.stringify({
    startingBalanceMinor: plan.startingBalance.minor.toString(),
    listPriceMinor: plan.listPrice.value.minor.toString(),
    ceilingMinis: plan.positionCeiling.value.minis,
    ceilingMicros: plan.positionCeiling.value.micros,
    drawdownAllowanceMinor: plan.drawdownAllowance.value.minor.toString(),
    dailyLossLimitMinor: plan.dailyLossLimit.value.minor.toString(),
    retainedBufferMinor: plan.retainedBuffer.value.minor.toString(),
    dailyCashCapMinor: plan.dailyCashPayoutCap.value.minor.toString(),
    trailingStopAtMinor: trailingStopFor(plan)?.minor.toString() ?? null,
    lifetimeCapKind: caps.lifetimeCapKind,
    lifetimeCapMinor: caps.lifetimeCapMinor?.toString() ?? null,
    requirementStatuses: requirementStatusMap(plan),
  });
}

function fingerprintOf(row: {
  startingBalanceMinor: bigint;
  listPriceMinor: bigint;
  ceilingMinis: number;
  ceilingMicros: number;
  drawdownAllowanceMinor: bigint;
  dailyLossLimitMinor: bigint;
  retainedBufferMinor: bigint;
  dailyCashCapMinor: bigint;
  trailingStopAtMinor: bigint | null;
  lifetimeCapKind: string;
  lifetimeCapMinor: bigint | null;
  requirementStatuses: string;
}): string {
  return JSON.stringify({
    startingBalanceMinor: row.startingBalanceMinor.toString(),
    listPriceMinor: row.listPriceMinor.toString(),
    ceilingMinis: row.ceilingMinis,
    ceilingMicros: row.ceilingMicros,
    drawdownAllowanceMinor: row.drawdownAllowanceMinor.toString(),
    dailyLossLimitMinor: row.dailyLossLimitMinor.toString(),
    retainedBufferMinor: row.retainedBufferMinor.toString(),
    dailyCashCapMinor: row.dailyCashCapMinor.toString(),
    trailingStopAtMinor: row.trailingStopAtMinor?.toString() ?? null,
    lifetimeCapKind: row.lifetimeCapKind,
    lifetimeCapMinor: row.lifetimeCapMinor?.toString() ?? null,
    requirementStatuses: JSON.parse(row.requirementStatuses) as unknown,
  });
}

export interface CatalogRevision {
  readonly planKey: string;
  readonly fromVersion: number;
  readonly toVersion: number;
}

/**
 * Publish a new version of any plan whose terms have changed in code.
 *
 * `publishCatalogIfEmpty` deliberately skips a plan that already has a
 * published version, which meant approving a cap or changing a risk figure in
 * `plans.ts` never reached the database. Accounts kept selling on the old terms
 * and the payout engine kept reading an UNRESOLVED cap.
 *
 * The old version is SUPERSEDED, never edited or deleted. Orders point at the
 * version they were sold under, so a customer's contract cannot be rewritten
 * after the fact — which is the whole reason plan terms are versioned rather
 * than stored as current values.
 *
 * Returns what changed, so a deploy can log it and an operator can see that a
 * commercial term moved.
 */
export async function publishCatalogRevisions(): Promise<readonly CatalogRevision[]> {
  const revisions: CatalogRevision[] = [];

  for (const plan of PLANS) {
    const current = await prisma.planVersion.findFirst({
      where: { planKey: plan.key, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
    });
    if (!current) continue; // publishCatalogIfEmpty handles a first publish.
    if (fingerprintOf(current) === termsFingerprint(plan)) continue;

    const blockers = planLaunchBlockers(plan);
    const nextVersion = current.version + 1;

    await prisma.$transaction([
      prisma.planVersion.update({
        where: { id: current.id },
        data: { status: 'SUPERSEDED' },
      }),
      prisma.planVersion.create({
        data: {
          planKey: plan.key,
          version: nextVersion,
          status: 'PUBLISHED',
          label: plan.label,
          startingBalanceMinor: plan.startingBalance.minor,
          listPriceMinor: plan.listPrice.value.minor,
          ceilingMinis: plan.positionCeiling.value.minis,
          ceilingMicros: plan.positionCeiling.value.micros,
          drawdownAllowanceMinor: plan.drawdownAllowance.value.minor,
          dailyLossLimitMinor: plan.dailyLossLimit.value.minor,
          retainedBufferMinor: plan.retainedBuffer.value.minor,
          dailyCashCapMinor: plan.dailyCashPayoutCap.value.minor,
          trailingStopAtMinor: trailingStopFor(plan)?.minor ?? null,
          ...lifetimeCapColumns(plan),
          requirementStatuses: JSON.stringify(requirementStatusMap(plan)),
          launchBlockers: JSON.stringify(blockers),
          sellableInProduction: blockers.length === 0,
          publishedAt: new Date(),
        },
      }),
    ]);

    revisions.push({ planKey: plan.key, fromVersion: current.version, toVersion: nextVersion });
  }

  return revisions;
}

export async function getPublishedPlanVersion(planKey: PlanKey) {
  const version = await prisma.planVersion.findFirst({
    where: { planKey, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  if (!version) {
    throw new Error(
      `No published plan version for ${planKey}. Run the catalog publish step before selling.`,
    );
  }
  return version;
}

export interface PlanRuleSnapshot {
  readonly planKey: string;
  readonly version: number;
  readonly label: string;
  readonly startingBalance: Money;
  readonly listPrice: Money;
  readonly ceilingMinis: number;
  readonly ceilingMicros: number;
  readonly drawdownAllowance: Money;
  readonly dailyLossLimit: Money;
  readonly retainedBuffer: Money;
  readonly dailyCashCap: Money;
  /** Where the threshold stops rising, or null when it never stops. */
  readonly trailingStopAt: Money | null;
  readonly lifetimeCapKind: string;
  readonly lifetimeCap: Money | null;
  readonly requirementStatuses: Record<string, string>;
  readonly launchBlockers: { field: string; status: string; detail: string }[];
}

/** Read a stored version back into domain types. */
export function toRuleSnapshot(version: {
  planKey: string;
  version: number;
  label: string;
  startingBalanceMinor: bigint;
  listPriceMinor: bigint;
  ceilingMinis: number;
  ceilingMicros: number;
  drawdownAllowanceMinor: bigint;
  dailyLossLimitMinor: bigint;
  retainedBufferMinor: bigint;
  dailyCashCapMinor: bigint;
  trailingStopAtMinor: bigint | null;
  lifetimeCapKind: string;
  lifetimeCapMinor: bigint | null;
  requirementStatuses: string;
  launchBlockers: string;
}): PlanRuleSnapshot {
  return {
    planKey: version.planKey,
    version: version.version,
    label: version.label,
    startingBalance: Money.fromMinor(version.startingBalanceMinor),
    listPrice: Money.fromMinor(version.listPriceMinor),
    ceilingMinis: version.ceilingMinis,
    ceilingMicros: version.ceilingMicros,
    drawdownAllowance: Money.fromMinor(version.drawdownAllowanceMinor),
    dailyLossLimit: Money.fromMinor(version.dailyLossLimitMinor),
    retainedBuffer: Money.fromMinor(version.retainedBufferMinor),
    dailyCashCap: Money.fromMinor(version.dailyCashCapMinor),
    trailingStopAt:
      version.trailingStopAtMinor === null ? null : Money.fromMinor(version.trailingStopAtMinor),
    lifetimeCapKind: version.lifetimeCapKind,
    // An UNRESOLVED cap never yields a usable number: callers must gate on kind.
    lifetimeCap:
      version.lifetimeCapKind === 'APPROVED_AMOUNT' && version.lifetimeCapMinor !== null
        ? Money.fromMinor(version.lifetimeCapMinor)
        : null,
    requirementStatuses: JSON.parse(version.requirementStatuses) as Record<string, string>,
    launchBlockers: JSON.parse(version.launchBlockers) as {
      field: string;
      status: string;
      detail: string;
    }[],
  };
}

/**
 * Lifetime capacity for the payout engine.
 *
 * Returns null ONLY for an explicitly approved uncapped policy. An unresolved
 * cap throws, because treating it as "no limit" is precisely the silent
 * approval of unbounded obligations this system is built to prevent.
 */
export function lifetimeCapForPayout(snapshot: PlanRuleSnapshot): Money | null {
  switch (snapshot.lifetimeCapKind) {
    case 'APPROVED_UNCAPPED':
      return null;
    case 'APPROVED_AMOUNT':
      if (!snapshot.lifetimeCap) {
        throw new Error('Lifetime cap is APPROVED_AMOUNT but no amount is stored');
      }
      return snapshot.lifetimeCap;
    default:
      throw new Error(
        `Lifetime payout cap for ${snapshot.planKey} is ${snapshot.lifetimeCapKind}. ` +
          'The owner must approve an amount or explicitly approve an uncapped policy ' +
          'before payouts can be processed on this plan.',
      );
  }
}
