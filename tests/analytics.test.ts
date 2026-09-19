/**
 * Analytics math.
 *
 * These are the figures the admin console makes decisions on, so they are
 * tested directly rather than through a page. The cases that matter most are
 * the empty ones and the boundaries: an account that has never traded, an
 * account sitting exactly on its threshold, a cluster with an uncapped member.
 */
import { describe, expect, it } from 'vitest';
import {
  bySide,
  bySymbol,
  byHour,
  computeTradeStats,
  durationDistribution,
  type ClosedTrade,
} from '@/domain/analytics/trade-stats';
import {
  dailyLossHeadroom,
  drawdownHeadroom,
  exposureRatio,
  firmExposure,
  remainingLifetimeCap,
} from '@/domain/analytics/exposure';
import {
  buildClusters,
  clusterExposure,
  findMatchedTrades,
  findOwnerSignals,
  normaliseAddress,
  type CorrelatableTrade,
} from '@/domain/analytics/correlation';

const at = (iso: string) => new Date(iso);

function trade(over: Partial<ClosedTrade> = {}): ClosedTrade {
  return {
    symbol: 'MNQ',
    side: 'LONG',
    quantity: 1,
    realisedPnlMinor: 0n,
    commissionMinor: 0n,
    openedAt: at('2026-09-19T14:00:00Z'),
    closedAt: at('2026-09-19T14:00:42Z'),
    ...over,
  };
}

describe('trade stats', () => {
  it('reports null, not zero, for an account that has never traded', () => {
    const stats = computeTradeStats([]);
    expect(stats.trades).toBe(0);
    expect(stats.winRate.value).toBeNull();
    expect(stats.profitFactor).toBeNull();
    expect(stats.expectancyMinor).toBeNull();
    expect(stats.averageHoldSeconds).toBeNull();
  });

  it('excludes scratches from win rate but still counts them', () => {
    const stats = computeTradeStats([
      trade({ realisedPnlMinor: 10_000n }),
      trade({ realisedPnlMinor: -5_000n }),
      trade({ realisedPnlMinor: 0n }),
    ]);
    expect(stats.trades).toBe(3);
    expect(stats.scratches).toBe(1);
    // 1 win of 2 decided trades, not 1 of 3.
    expect(stats.winRate).toMatchObject({ numerator: 1, denominator: 2, value: 0.5 });
  });

  it('computes profit factor as gross profit over gross loss', () => {
    const stats = computeTradeStats([
      trade({ realisedPnlMinor: 30_000n }),
      trade({ realisedPnlMinor: 10_000n }),
      trade({ realisedPnlMinor: -20_000n }),
    ]);
    expect(stats.grossProfitMinor).toBe(40_000n);
    expect(stats.grossLossMinor).toBe(20_000n);
    expect(stats.profitFactor).toBe(2);
  });

  it('returns null profit factor when nothing has lost, rather than Infinity', () => {
    const stats = computeTradeStats([trade({ realisedPnlMinor: 10_000n })]);
    expect(stats.profitFactor).toBeNull();
  });

  it('keeps expectancy in integer minor units', () => {
    const stats = computeTradeStats([
      trade({ realisedPnlMinor: 10_000n }),
      trade({ realisedPnlMinor: 5_001n }),
    ]);
    // 15001 / 2 = 7500.5, truncated toward zero. Never a fractional cent.
    expect(stats.expectancyMinor).toBe(7_500n);
    expect(typeof stats.expectancyMinor).toBe('bigint');
  });

  it('finds the largest win and loss including negatives', () => {
    const stats = computeTradeStats([
      trade({ realisedPnlMinor: 10_000n }),
      trade({ realisedPnlMinor: 30_000n }),
      trade({ realisedPnlMinor: -40_000n }),
      trade({ realisedPnlMinor: -5_000n }),
    ]);
    expect(stats.largestWinMinor).toBe(30_000n);
    expect(stats.largestLossMinor).toBe(-40_000n);
  });

  it('splits long and short independently', () => {
    const split = bySide([
      trade({ side: 'LONG', realisedPnlMinor: 10_000n }),
      trade({ side: 'SHORT', realisedPnlMinor: -10_000n }),
    ]);
    expect(split.long.netPnlMinor).toBe(10_000n);
    expect(split.short.netPnlMinor).toBe(-10_000n);
  });

  it('orders symbols by net P&L descending', () => {
    const rows = bySymbol([
      trade({ symbol: 'ES', realisedPnlMinor: 5_000n }),
      trade({ symbol: 'MNQ', realisedPnlMinor: 20_000n }),
      trade({ symbol: 'CL', realisedPnlMinor: -1_000n }),
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(['MNQ', 'ES', 'CL']);
  });

  it('buckets by hour in the named zone, not in UTC', () => {
    // 14:00 UTC is 10:00 in New York on this date.
    const rows = byHour([trade({ openedAt: at('2026-09-19T14:00:00Z') })], 'America/New_York');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hour).toBe(10);
  });

  it('places a trade on a bucket boundary in the lower bucket', () => {
    // Exactly 60 seconds is "under 1m", not "1-5m": boundaries are inclusive
    // upward, so no trade can fall into two buckets or none.
    const rows = durationDistribution([
      trade({ openedAt: at('2026-09-19T14:00:00Z'), closedAt: at('2026-09-19T14:01:00Z') }),
    ]);
    expect(rows.find((r) => r.label === 'Under 1m')!.count).toBe(1);
    expect(rows.find((r) => r.label === '1–5m')!.count).toBe(0);
  });
});

describe('drawdown headroom', () => {
  it('is zero, and critical, when equity sits exactly on the threshold', () => {
    // Touching is a breach, so an account on its threshold is already gone.
    const room = drawdownHeadroom({
      equityMinor: 4_800_000n,
      thresholdMinor: 4_800_000n,
      drawdownAllowanceMinor: 180_000n,
    });
    expect(room.remainingMinor).toBe(0n);
    expect(room.band).toBe('CRITICAL');
  });

  it('never reports negative room once equity is below the threshold', () => {
    const room = drawdownHeadroom({
      equityMinor: 4_700_000n,
      thresholdMinor: 4_800_000n,
      drawdownAllowanceMinor: 180_000n,
    });
    expect(room.remainingMinor).toBe(0n);
  });

  it('bands at 25% and 10% of the allowance', () => {
    const band = (remaining: bigint) =>
      drawdownHeadroom({
        equityMinor: 5_000_000n + remaining,
        thresholdMinor: 5_000_000n,
        drawdownAllowanceMinor: 100_000n,
      }).band;
    expect(band(50_000n)).toBe('COMFORTABLE');
    expect(band(25_000n)).toBe('TIGHT');
    expect(band(10_000n)).toBe('CRITICAL');
  });
});

describe('daily loss headroom', () => {
  it('ignores withdrawals, which lower equity without being trading losses', () => {
    // Withdrew $2,000 and traded flat: equity is down, daily loss is zero.
    const room = dailyLossHeadroom({
      equityMinor: 4_800_000n,
      sessionStartEquityMinor: 5_000_000n,
      sessionWithdrawalsMinor: 200_000n,
      dailyLossLimitMinor: 59_500n,
    });
    expect(room.remainingMinor).toBe(59_500n);
    expect(room.band).toBe('COMFORTABLE');
  });

  it('never exceeds the allowance on a profitable session', () => {
    const room = dailyLossHeadroom({
      equityMinor: 5_500_000n,
      sessionStartEquityMinor: 5_000_000n,
      sessionWithdrawalsMinor: 0n,
      dailyLossLimitMinor: 59_500n,
    });
    expect(room.remainingMinor).toBe(59_500n);
  });

  it('reaches zero exactly at the limit', () => {
    const room = dailyLossHeadroom({
      equityMinor: 4_940_500n,
      sessionStartEquityMinor: 5_000_000n,
      sessionWithdrawalsMinor: 0n,
      dailyLossLimitMinor: 59_500n,
    });
    expect(room.remainingMinor).toBe(0n);
  });
});

describe('remaining lifetime capacity', () => {
  it('treats reserved capacity as already consumed', () => {
    // Otherwise two requests could share one allowance.
    expect(
      remainingLifetimeCap({
        lifetimeCapMinor: 900_000n,
        reservedMinor: 25_000n,
        consumedMinor: 50_000n,
      }),
    ).toBe(825_000n);
  });

  it('returns null for an approved uncapped policy, never zero', () => {
    expect(
      remainingLifetimeCap({ lifetimeCapMinor: null, reservedMinor: 0n, consumedMinor: 0n }),
    ).toBeNull();
  });

  it('floors at zero rather than going negative', () => {
    expect(
      remainingLifetimeCap({
        lifetimeCapMinor: 100_000n,
        reservedMinor: 0n,
        consumedMinor: 150_000n,
      }),
    ).toBe(0n);
  });
});

describe('firm exposure', () => {
  it('excludes dead accounts and counts uncapped ones separately', () => {
    const total = firmExposure([
      { tradingAccountId: 'a', remainingLifetimeCapMinor: 600_000n, isLive: true },
      { tradingAccountId: 'b', remainingLifetimeCapMinor: 900_000n, isLive: true },
      { tradingAccountId: 'c', remainingLifetimeCapMinor: 500_000n, isLive: false },
      { tradingAccountId: 'd', remainingLifetimeCapMinor: null, isLive: true },
    ]);
    expect(total.openExposureMinor).toBe(1_500_000n);
    expect(total.liveAccounts).toBe(3);
    // An uncapped account is unbounded, so it is reported, not summed as zero.
    expect(total.uncappedAccounts).toBe(1);
  });
});

describe('exposure ratio', () => {
  it('matches the published worst case on the $25K account', () => {
    // $261.75 paid against a $6,000 lifetime cap.
    const ratio = exposureRatio({ pricePaidMinor: 26_175n, lifetimeCapMinor: 600_000n });
    expect(ratio).toBeCloseTo(22.9, 1);
  });

  it('rises as a discount deepens, while the cap stays put', () => {
    const list = exposureRatio({ pricePaidMinor: 34_900n, lifetimeCapMinor: 600_000n })!;
    const half = exposureRatio({ pricePaidMinor: 17_450n, lifetimeCapMinor: 600_000n })!;
    expect(list).toBeCloseTo(17.2, 1);
    expect(half).toBeCloseTo(34.4, 1);
    expect(half).toBeGreaterThan(list);
  });

  it('is null for a free account rather than infinite', () => {
    expect(exposureRatio({ pricePaidMinor: 0n, lifetimeCapMinor: 600_000n })).toBeNull();
  });
});

describe('correlated trade detection', () => {
  const base = {
    symbol: 'MNQ',
    side: 'SHORT' as const,
    entryPriceE8: 2_012_525_000_000n,
  };

  const corr = (id: string, account: string, seconds: number, over = {}): CorrelatableTrade => ({
    id,
    tradingAccountId: account,
    ...base,
    openedAt: new Date(at('2026-09-19T14:30:00Z').getTime() + seconds * 1000),
    ...over,
  });

  it('finds five accounts taking the identical trade in the same second', () => {
    const groups = findMatchedTrades([
      corr('t1', 'acc-0021', 0),
      corr('t2', 'acc-0022', 0),
      corr('t3', 'acc-0023', 0),
      corr('t4', 'acc-0024', 0),
      corr('t5', 'acc-0025', 0),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.tradingAccountIds).toHaveLength(5);
  });

  it('does not match one account trading twice inside the window', () => {
    // A scalper is not a cluster.
    expect(findMatchedTrades([corr('t1', 'acc-1', 0), corr('t2', 'acc-1', 2)])).toHaveLength(0);
  });

  it('respects the tolerance window at its edge', () => {
    const inside = findMatchedTrades([corr('t1', 'acc-1', 0), corr('t2', 'acc-2', 5)]);
    const outside = findMatchedTrades([corr('t1', 'acc-1', 0), corr('t2', 'acc-2', 6)]);
    expect(inside).toHaveLength(1);
    expect(outside).toHaveLength(0);
  });

  it('does not match a different symbol, side or price', () => {
    expect(
      findMatchedTrades([corr('t1', 'acc-1', 0), corr('t2', 'acc-2', 1, { symbol: 'ES' })]),
    ).toHaveLength(0);
    expect(
      findMatchedTrades([corr('t1', 'acc-1', 0), corr('t2', 'acc-2', 1, { side: 'LONG' })]),
    ).toHaveLength(0);
    expect(
      findMatchedTrades([
        corr('t1', 'acc-1', 0),
        corr('t2', 'acc-2', 1, { entryPriceE8: 2_012_550_000_000n }),
      ]),
    ).toHaveLength(0);
  });

  it('uses the provider timestamp, so receipt order cannot invent a cluster', () => {
    // Fed out of order; still one group, anchored on the earliest open.
    const groups = findMatchedTrades([corr('t2', 'acc-2', 3), corr('t1', 'acc-1', 0)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.openedAt.toISOString()).toBe('2026-09-19T14:30:00.000Z');
  });

  it('joins overlapping pairs into one cluster', () => {
    // A-B and B-C are two groups but one copier.
    const groups = findMatchedTrades([
      corr('t1', 'acc-a', 0),
      corr('t2', 'acc-b', 1),
      corr('t3', 'acc-b', 60),
      corr('t4', 'acc-c', 61),
    ]);
    const clusters = buildClusters(groups);
    expect(clusters).toHaveLength(1);
    expect([...clusters[0]!.tradingAccountIds].sort()).toEqual(['acc-a', 'acc-b', 'acc-c']);
  });

  it('reports an unbounded cluster exposure as null, not as the sum of the rest', () => {
    const cluster = buildClusters(
      findMatchedTrades([corr('t1', 'acc-1', 0), corr('t2', 'acc-2', 1)]),
    )[0]!;
    const exposure = clusterExposure(
      cluster,
      new Map([
        ['acc-1', { remainingLifetimeCapMinor: 600_000n, equityMinor: 0n, openMicroEquivalents: 10 }],
        ['acc-2', { remainingLifetimeCapMinor: null, equityMinor: 0n, openMicroEquivalents: 5 }],
      ]),
    );
    expect(exposure.combinedRemainingCapMinor).toBeNull();
    expect(exposure.combinedOpenMicroEquivalents).toBe(15);
  });

  it('sums combined capacity when every member is capped', () => {
    const cluster = buildClusters(
      findMatchedTrades([corr('t1', 'acc-1', 0), corr('t2', 'acc-2', 1)]),
    )[0]!;
    const exposure = clusterExposure(
      cluster,
      new Map([
        ['acc-1', { remainingLifetimeCapMinor: 600_000n, equityMinor: 100n, openMicroEquivalents: 0 }],
        ['acc-2', { remainingLifetimeCapMinor: 900_000n, equityMinor: 200n, openMicroEquivalents: 0 }],
      ]),
    );
    expect(exposure.combinedRemainingCapMinor).toBe(1_500_000n);
    expect(exposure.combinedEquityMinor).toBe(300n);
  });
});

describe('owner signals', () => {
  const account = (id: string, userId: string, address: string | null, domain: string | null) => ({
    tradingAccountId: id,
    userId,
    normalisedAddress: address,
    emailDomain: domain,
  });

  it('reports same-user and same-address as separate signals', () => {
    const signals = findOwnerSignals([
      account('a1', 'u1', '1 example st|60601|us', 'example.invalid'),
      account('a2', 'u1', '1 example st|60601|us', 'example.invalid'),
      account('a3', 'u2', '1 example st|60601|us', 'example.invalid'),
    ]);
    const kinds = signals.map((s) => s.kind);
    expect(kinds).toContain('SAME_USER');
    expect(kinds).toContain('SAME_POSTAL_ADDRESS');
    // Same-owner and same-address are different facts; they are not merged.
    expect(signals.find((s) => s.kind === 'SAME_USER')!.tradingAccountIds).toEqual(['a1', 'a2']);
    expect(signals.find((s) => s.kind === 'SAME_POSTAL_ADDRESS')!.tradingAccountIds).toHaveLength(3);
  });

  it('leaves the weak email-domain signal off unless asked for', () => {
    const accounts = [
      account('a1', 'u1', null, 'gmail.com'),
      account('a2', 'u2', null, 'gmail.com'),
    ];
    expect(findOwnerSignals(accounts).map((s) => s.kind)).not.toContain('SAME_EMAIL_DOMAIN');
    expect(
      findOwnerSignals(accounts, { includeEmailDomain: true }).map((s) => s.kind),
    ).toContain('SAME_EMAIL_DOMAIN');
  });

  it('folds case and whitespace when normalising an address', () => {
    expect(
      normaliseAddress({ addressLine1: ' 1 Example  St ', postalCode: '60601', countryCode: 'US' }),
    ).toBe('1 example st|60601|us');
    expect(
      normaliseAddress({ addressLine1: null, postalCode: null, countryCode: null }),
    ).toBeNull();
  });
});
