import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCurrentUser } from '@/server/auth/session';
import { getDashboardAccount, listAccounts } from '@/server/views/dashboard-view';
import { Badge, Callout, Card, DataRow, StatusDot } from '@/components/ui';
import { checkPayoutProfile } from '@/domain/customer/profile';
import { prisma } from '@/server/db';
import { PayoutRequestForm } from '@/components/PayoutRequestForm';
import { ResetCard, type ResetOfferView } from '@/components/ResetCard';
import { getResetOffer } from '@/server/services/reset-service';
import { getConfig } from '@/server/config';

export const metadata: Metadata = { title: 'Your dashboard' };
export const dynamic = 'force-dynamic';

function statusTone(status: string) {
  switch (status) {
    case 'ACTIVE':
      return 'accent' as const;
    case 'DAILY_PAUSED':
      return 'warn' as const;
    case 'BREACHED':
    case 'SUSPENDED':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
}

function statusWords(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'Active';
    case 'DAILY_PAUSED':
      return 'Locked until the market reopens';
    case 'BREACHED':
      return 'Trading access ended';
    case 'SUSPENDED':
      return 'Suspended';
    case 'PENDING':
      return 'Not yet active';
    default:
      return status;
  }
}

function relativeAge(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=%2Fdashboard');

  const params = await searchParams;
  const accounts = await listAccounts(user.id);

  if (accounts.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight">You do not have an account yet</h1>
        <p className="mt-3 text-fg-muted">
          Choose an account size to get started. There is no evaluation phase, so you can trade it
          the same day.
        </p>
        <Link
          href="/accounts"
          className="mt-6 inline-block rounded-lg bg-accent px-6 py-3 font-semibold text-bg hover:bg-accent-strong"
        >
          Compare accounts
        </Link>
      </div>
    );
  }

  const requested = typeof params.account === 'string' ? params.account : null;
  const selectedId = accounts.find((a) => a.id === requested)?.id ?? accounts[0]!.id;
  const account = await getDashboardAccount(user.id, selectedId);
  if (!account) redirect('/dashboard');

  // A reset is only offered on an account that can no longer trade.
  const config = getConfig();
  const rawOffer =
    account.tradingStatus === 'ACTIVE' ? null : await getResetOffer(user.id, selectedId);
  const resetOffer: ResetOfferView | null = rawOffer
    ? {
        tradingAccountId: rawOffer.tradingAccountId,
        planLabel: rawOffer.planLabel,
        price: rawOffer.price.format(),
        newAccountPrice: rawOffer.newAccountPrice.format(),
        saving: rawOffer.saving.format(),
        allowed: rawOffer.allowed,
        reason: rawOffer.reason,
        resetCount: rawOffer.resetCount,
        idempotencyKey: randomUUID(),
        isDemo: config.isDemo,
      }
    : null;

  const exposurePercent =
    account.exposureCap > 0
      ? Math.min(100, Math.round((account.exposureMicroEquivalents / account.exposureCap) * 100))
      : 0;
  const dailyUsedPercent =
    Number(account.dailyLossLimit.decimal) > 0
      ? Math.min(
          100,
          Math.round(
            (Number(account.dailyLossUsed.decimal) / Number(account.dailyLossLimit.decimal)) * 100,
          ),
        )
      : 0;

  // Checked here so the prompt appears while there is still time to act on it,
  // rather than at the moment a payout is refused.
  const customerProfile = await prisma.customerProfile.findUnique({
    where: { userId: user.id },
    select: {
      phone: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      region: true,
      postalCode: true,
      countryCode: true,
    },
  });
  const profileCheck = checkPayoutProfile(
    customerProfile ?? {
      phone: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      region: null,
      postalCode: null,
      countryCode: null,
    },
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your dashboard</h1>
          <p className="text-sm text-fg-muted mt-1">
            Signed in as {user.email}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/profile"
            className="rounded-lg border border-border-strong px-4 py-2 text-sm hover:border-accent hover:text-accent"
          >
            Your details
          </Link>
          <Link
            href="/dashboard/documents"
            className="rounded-lg border border-border-strong px-4 py-2 text-sm hover:border-accent hover:text-accent"
          >
            Documents &amp; receipts
          </Link>
          <Link
            href={`/api/accounts/${account.id}/export`}
            className="rounded-lg border border-border-strong px-4 py-2 text-sm hover:border-accent hover:text-accent"
          >
            Export CSV
          </Link>
        </div>
      </header>

      {!profileCheck.ok && (
        <Callout tone="warn" title="Add your details before your first payout">
          We need an address and a contact number to pay you. Adding them now means a payout
          request is not held up later.{' '}
          <Link href="/dashboard/profile" className="text-accent hover:underline">
            Add your details
          </Link>
          .
        </Callout>
      )}

      {accounts.length > 1 && (
        <nav aria-label="Your accounts" className="flex flex-wrap gap-2">
          {accounts.map((option) => (
            <Link
              key={option.id}
              href={`/dashboard?account=${option.id}`}
              aria-current={option.id === selectedId ? 'page' : undefined}
              className={`rounded-lg border px-4 py-2 text-sm ${
                option.id === selectedId
                  ? 'border-accent bg-accent-dim/30 text-accent'
                  : 'border-border bg-surface hover:border-border-strong'
              }`}
            >
              {option.label}
            </Link>
          ))}
        </nav>
      )}

      {/* ---------------------------- status ---------------------------- */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <StatusDot tone={statusTone(account.tradingStatus)} />
              <h2 className="text-lg font-semibold">
                {account.planLabel} simulated account
              </h2>
              <Badge tone={statusTone(account.tradingStatus)}>
                {statusWords(account.tradingStatus)}
              </Badge>
            </div>
            {account.statusReason && (
              <p className="mt-2 text-sm text-fg-muted max-w-2xl leading-relaxed">
                {account.statusReason}
              </p>
            )}
            {!account.isTradeable && !account.statusReason && (
              <p className="mt-2 text-sm text-fg-muted">{account.provisioningStatus.detail}</p>
            )}
          </div>
          <div className="text-right text-sm">
            <p className="text-fg-subtle">Last data sync</p>
            <p className={account.dataStale ? 'text-warn' : 'text-fg'}>
              {relativeAge(account.lastSyncAgeSeconds)}
            </p>
          </div>
        </div>

        {account.isLockedOut && account.lockedOutUntil && (
          <div className="mt-4">
            <Callout tone="warn" title="Locked out until the market reopens">
              You reached your daily loss limit. Trading is locked until the Globex reopen at{' '}
              {new Date(account.lockedOutUntil).toLocaleString('en-US', {
                timeZone: 'America/New_York',
                dateStyle: 'medium',
                timeStyle: 'short',
              })}{' '}
              ET. Your daily allowance refreshes at the session roll an hour earlier, but the
              market is closed until then.
            </Callout>
          </div>
        )}

        {account.dataStale && (
          <div className="mt-4">
            <Callout tone="warn" title="Account data is not current">
              We have not received fresh authoritative data for this account. Payout requests and
              new exposure are blocked until it reconciles. The figures below are the last ones we
              could verify — they may not reflect your account right now.
            </Callout>
          </div>
        )}

        {account.externalAccountId ? (
          <p className="mt-4 text-xs text-fg-subtle">
            Platform account <span className="font-mono">{account.externalAccountId}</span>. Sign in
            through the platform using the invitation sent to your registered email address. We
            never send a reusable password by email.
          </p>
        ) : (
          <p className="mt-4 text-xs text-warn">
            No platform account exists for this order yet. {account.provisioningStatus.detail}
          </p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* ------------------------- left: account ---------------------- */}
        <div className="lg:col-span-7 space-y-6">
          <Card className="p-5">
            <h2 className="font-semibold mb-1">Simulated account</h2>
            <p className="text-xs text-fg-subtle mb-3">
              These are simulated units used to measure performance. They are not cash and cannot be
              withdrawn.
            </p>
            <dl>
              <DataRow
                label="Simulated equity"
                value={account.simulatedEquity.display}
                emphasis
                hint="Balance plus unrealized profit and loss on open positions."
              />
              <DataRow label="Simulated balance" value={account.simulatedBalance.display} />
              <DataRow label="Starting balance" value={account.startingBalance.display} />
              <DataRow
                label="Unrealized P&L"
                value={account.unrealised.display}
                hint="On currently open positions."
              />
              <DataRow
                label="Commissions and fees this session"
                value={account.commissions.display}
                hint="Already reflected in the figures above. They are never counted twice."
              />
            </dl>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold mb-3">
              Session limits
              {account.sessionDate && (
                <span className="ml-2 text-xs font-normal text-fg-subtle">
                  session {account.sessionDate}
                </span>
              )}
            </h2>

            <div className="mb-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-fg-muted">Daily loss used</span>
                <span className="tnum">
                  {account.dailyLossUsed.display} / {account.dailyLossLimit.display}
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={dailyUsedPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Daily loss allowance used"
                className="h-2 rounded-full bg-surface-raised overflow-hidden"
              >
                <div
                  className={`h-full ${dailyUsedPercent > 75 ? 'bg-danger' : dailyUsedPercent > 50 ? 'bg-warn' : 'bg-accent'}`}
                  style={{ width: `${dailyUsedPercent}%` }}
                />
              </div>
              <p className="text-xs text-fg-subtle mt-1">
                {account.dailyLossRemaining.display} remaining. Withdrawals are excluded from this
                figure — they reduce your balance but are not trading losses.
              </p>
            </div>

            <dl>
              <DataRow
                label="Session trading P&L"
                value={account.sessionPnl.display}
                hint="Realized and unrealized, after costs, excluding any withdrawal."
              />
              <DataRow
                label="Max drawdown threshold"
                value={account.trailingThreshold.display}
                hint="Equity touching this is a maximum drawdown breach and ends trading access. It never moves down."
              />
              <DataRow
                label="Room above threshold"
                value={account.trailingRoom.display}
                emphasis
              />
              <DataRow
                label="Highest equity observed"
                value={account.highWater.display}
                hint="Includes unrealized peaks on open positions."
              />
              <DataRow
                label="Threshold stops rising at"
                value={account.trailingStopsAt?.display ?? 'It never stops'}
                hint={
                  account.trailingStopsAt
                    ? undefined
                    : 'It follows your highest equity for the life of the account, so your room above it is never more than your drawdown allowance.'
                }
              />
            </dl>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold mb-3">Position exposure</h2>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-fg-muted">Micro-equivalent units</span>
              <span className="tnum">
                {account.exposureMicroEquivalents} / {account.exposureCap}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={exposurePercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Position exposure used"
              className="h-2 rounded-full bg-surface-raised overflow-hidden"
            >
              <div className="h-full bg-accent" style={{ width: `${exposurePercent}%` }} />
            </div>
            <p className="text-xs text-fg-subtle mt-2">
              Minis and micros share one limit at ten micros per mini. Working entry orders count as
              well as filled positions.
            </p>
            {account.positions.length > 0 ? (
              <ul className="mt-3 space-y-1 text-sm">
                {account.positions.map((position) => (
                  <li key={position.symbol} className="flex justify-between">
                    <span className="font-mono">{position.symbol}</span>
                    <span className="tnum">
                      {position.signedQuantity > 0 ? '+' : ''}
                      {position.signedQuantity}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-fg-subtle">No open positions.</p>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold mb-3">Account events</h2>
            {account.riskEvents.length === 0 ? (
              <p className="text-sm text-fg-subtle">Nothing to report.</p>
            ) : (
              <ul className="space-y-3">
                {account.riskEvents.map((event) => (
                  <li key={event.id} className="border-b border-border last:border-0 pb-3 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {event.eventType.replaceAll('_', ' ').toLowerCase()}
                        </p>
                        <p className="text-sm text-fg-muted mt-0.5 leading-relaxed">
                          {event.reason}
                        </p>
                        {event.actionConfirmed === false && (
                          <p className="text-xs text-danger mt-1">
                            We requested this action at the platform but did not receive
                            confirmation.
                          </p>
                        )}
                      </div>
                      <Badge
                        tone={
                          event.severity === 'CRITICAL'
                            ? 'danger'
                            : event.severity === 'WARNING'
                              ? 'warn'
                              : 'neutral'
                        }
                      >
                        {event.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-fg-subtle mt-1">
                      {new Date(event.occurredAt).toLocaleString('en-US')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* ------------------------- right: payouts --------------------- */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="p-5">
            <h2 className="font-semibold mb-1">Payout</h2>
            <p className="text-xs text-fg-subtle mb-3">
              Real cash, calculated against simulated profits. You receive half of any gross
              withdrawal.
            </p>

            {/* Progress toward the first payout: the question every new trader
                actually has, answered before the limits that gate it. */}
            {!account.firstWithdrawal.reached && (
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-fg-muted">Progress to your first payout</span>
                  <span className="tnum">{account.firstWithdrawal.percent}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={account.firstWithdrawal.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Progress toward your first payout"
                  className="h-2 rounded-full bg-surface-raised overflow-hidden"
                >
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${account.firstWithdrawal.percent}%` }}
                  />
                </div>
                <p className="text-xs text-fg-subtle mt-1.5 leading-relaxed">
                  <span className="text-fg tnum">{account.firstWithdrawal.remaining.display}</span>{' '}
                  more profit reaches{' '}
                  <span className="text-fg tnum">{account.firstWithdrawal.targetBalance.display}</span>,
                  where your first {account.minimumGross.display} gross withdrawal becomes available.
                </p>
              </div>
            )}

            <div className="mb-4 flex items-center gap-2">
              <Badge tone={account.firstWithdrawal.bufferMet ? 'accent' : 'neutral'}>
                {account.firstWithdrawal.bufferMet ? 'Buffer met' : 'Buffer not met'}
              </Badge>
              <span className="text-xs text-fg-subtle">
                {account.firstWithdrawal.bufferMet
                  ? `Your profit covers the ${account.retainedBuffer.display} retained buffer.`
                  : `${account.retainedBuffer.display} of profit stays in the account before any payout.`}
              </span>
            </div>

            <dl className="mb-4">
              <DataRow
                label="Available gross"
                value={account.maxGross.display}
                hint="The most you can request right now."
              />
              <DataRow label="Cash that would pay" value={account.maxCash.display} emphasis />
              <DataRow label="Retained buffer" value={account.retainedBuffer.display} />
              <DataRow
                label="Remaining daily cash capacity"
                value={account.remainingDailyCash.display}
              />
              {account.remainingLifetimeCash && (
                <DataRow
                  label="Remaining lifetime cash capacity"
                  value={account.remainingLifetimeCash.display}
                />
              )}
            </dl>

            {account.lifetimeCapBlocked ? (
              <Callout tone="warn" title="Payouts are not available on this plan yet">
                {account.lifetimeCapMessage}
              </Callout>
            ) : account.payoutEligible ? (
              <PayoutRequestForm
                tradingAccountId={account.id}
                maxGrossDecimal={account.maxGross.decimal}
                maxGrossDisplay={account.maxGross.display}
                maxCashDisplay={account.maxCash.display}
                minimumGrossDecimal={account.minimumGross.decimal}
                idempotencyKey={randomUUID()}
              />
            ) : (
              <Callout tone="neutral" title="Not available right now">
                <p>{account.payoutExplanation}</p>
                <ul className="mt-2 space-y-1 text-xs">
                  {!account.preconditions.isFlat && <li>&bull; Close all positions first.</li>}
                  {account.preconditions.hasConflictingOrders && (
                    <li>&bull; Cancel all working orders first.</li>
                  )}
                  {!account.preconditions.accountIsActive && (
                    <li>&bull; This account is not currently active.</li>
                  )}
                  {account.preconditions.dataIsStale && (
                    <li>&bull; We are waiting for current account data.</li>
                  )}
                </ul>
              </Callout>
            )}
          </Card>

          {resetOffer && <ResetCard offer={resetOffer} />}

          <Card className="p-5">
            <h2 className="font-semibold mb-3">Payout history</h2>
            {account.payouts.length === 0 ? (
              <p className="text-sm text-fg-subtle">No payout requests yet.</p>
            ) : (
              <ul className="space-y-3">
                {account.payouts.map((payout) => (
                  <li key={payout.id} className="border-b border-border last:border-0 pb-3 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="tnum text-sm">
                          {payout.gross.display} gross &rarr;{' '}
                          <span className="text-accent">{payout.cash.display} cash</span>
                        </p>
                        <p className="text-xs text-fg-subtle mt-0.5">
                          Session {payout.sessionDate} &middot; requested{' '}
                          {new Date(payout.createdAt).toLocaleDateString('en-US')}
                        </p>
                      </div>
                      <Badge
                        tone={
                          payout.state === 'paid'
                            ? 'accent'
                            : payout.state === 'needs_reconciliation'
                              ? 'warn'
                              : payout.state === 'rejected' || payout.state === 'failed'
                                ? 'danger'
                                : 'neutral'
                        }
                      >
                        {payout.state.replaceAll('_', ' ')}
                      </Badge>
                    </div>
                    {payout.note && (
                      <p className="text-xs text-fg-muted mt-1 leading-relaxed">{payout.note}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-fg-subtle mt-3 leading-relaxed">
              Eligibility, processing and settlement are separate stages. Being eligible today does
              not guarantee funds reach your bank today.
            </p>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold mb-3">Your extras</h2>
            {account.entitlements.length === 0 ? (
              <p className="text-sm text-fg-subtle">
                You have not purchased any extras. Nothing about your account, your rules or your
                payouts depends on them.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {account.entitlements.map((entitlement) => (
                  <li key={entitlement.addOnKey} className="flex justify-between">
                    <span>{entitlement.addOnKey.replaceAll('_', ' ').toLowerCase()}</span>
                    <span className="text-fg-subtle text-xs">
                      {entitlement.expiresAt
                        ? `until ${new Date(entitlement.expiresAt).toLocaleDateString('en-US')}`
                        : 'no expiry'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold mb-2">Security and support</h2>
            <ul className="text-sm space-y-2 text-fg-muted">
              <li>
                Signed in as <span className="text-fg">{user.email}</span>
              </li>
              <li>
                Multi-factor authentication:{' '}
                <span className="text-fg">{user.mfaEnabledAt ? 'enrolled' : 'not enrolled'}</span>
              </li>
              <li>
                <Link href="/contact" className="text-accent hover:underline">
                  Contact support
                </Link>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
