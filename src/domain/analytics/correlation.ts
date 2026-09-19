/**
 * Correlated-account detection.
 *
 * The risk this exists for: one trader running a copier across several funded
 * accounts. Five accounts taking the identical MNQ short in the same second is
 * one decision, not five — and if it wins at size the firm owes five payouts on
 * it while believing the book was diversified.
 *
 * Two signals, deliberately kept apart:
 *
 *   SAME TRADE   accounts taking matching positions within a tolerance window.
 *                Evidence of coordination however the accounts are owned.
 *   SAME OWNER   accounts sharing a person, address or payment method.
 *                Evidence of common control regardless of what they trade.
 *
 * They are not merged, because they mean different things and have different
 * remedies. Two strangers copying the same public signal service is the first
 * without the second; one person's five accounts trading independently is the
 * second without the first. Both are worth seeing; conflating them tells you
 * neither.
 *
 * This module FLAGS and QUANTIFIES. It never bans anything — a human decides.
 */

export interface CorrelatableTrade {
  readonly id: string;
  readonly tradingAccountId: string;
  readonly symbol: string;
  readonly side: 'LONG' | 'SHORT';
  readonly entryPriceE8: bigint;
  /**
   * The time the PROVIDER says the position opened, never the time we received
   * it. Receipt order reflects network jitter and delivery batching, which
   * would both invent clusters and hide real ones.
   */
  readonly openedAt: Date;
}

export interface CorrelationConfig {
  /** Trades this far apart or closer may match. Default ±5 seconds. */
  readonly toleranceSeconds: number;
  /**
   * Allowed entry-price difference, as an absolute scaled-integer delta.
   * Zero means the fills must be identical to the tick.
   */
  readonly priceToleranceE8: bigint;
  /** A cluster needs at least this many distinct accounts to be reported. */
  readonly minimumAccounts: number;
}

export const DEFAULT_CORRELATION_CONFIG: CorrelationConfig = {
  toleranceSeconds: 5,
  priceToleranceE8: 0n,
  minimumAccounts: 2,
};

export interface MatchedTradeGroup {
  readonly symbol: string;
  readonly side: 'LONG' | 'SHORT';
  readonly entryPriceE8: bigint;
  readonly openedAt: Date;
  readonly tradeIds: readonly string[];
  readonly tradingAccountIds: readonly string[];
}

/**
 * Trades that match on symbol, side and entry price within the time window.
 *
 * Sorted by time, then swept forward, so the comparison is linear in the window
 * rather than quadratic across the whole book. Trades on ONE account never
 * match each other — an account trading twice in five seconds is a scalper, not
 * a cluster.
 */
export function findMatchedTrades(
  trades: readonly CorrelatableTrade[],
  config: CorrelationConfig = DEFAULT_CORRELATION_CONFIG,
): readonly MatchedTradeGroup[] {
  const toleranceMs = config.toleranceSeconds * 1000;
  const sorted = [...trades].sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
  const groups: MatchedTradeGroup[] = [];
  const claimed = new Set<string>();

  for (let i = 0; i < sorted.length; i += 1) {
    const anchor = sorted[i]!;
    if (claimed.has(anchor.id)) continue;

    const members = [anchor];
    const accounts = new Set([anchor.tradingAccountId]);

    for (let j = i + 1; j < sorted.length; j += 1) {
      const candidate = sorted[j]!;
      if (candidate.openedAt.getTime() - anchor.openedAt.getTime() > toleranceMs) break;
      if (claimed.has(candidate.id)) continue;
      if (candidate.tradingAccountId === anchor.tradingAccountId) continue;
      if (candidate.symbol !== anchor.symbol || candidate.side !== anchor.side) continue;

      const priceDelta =
        candidate.entryPriceE8 > anchor.entryPriceE8
          ? candidate.entryPriceE8 - anchor.entryPriceE8
          : anchor.entryPriceE8 - candidate.entryPriceE8;
      if (priceDelta > config.priceToleranceE8) continue;

      members.push(candidate);
      accounts.add(candidate.tradingAccountId);
    }

    if (accounts.size < config.minimumAccounts) continue;

    for (const member of members) claimed.add(member.id);
    groups.push({
      symbol: anchor.symbol,
      side: anchor.side,
      entryPriceE8: anchor.entryPriceE8,
      openedAt: anchor.openedAt,
      tradeIds: members.map((m) => m.id),
      tradingAccountIds: [...accounts],
    });
  }

  return groups;
}

export interface CorrelationCluster {
  readonly tradingAccountIds: readonly string[];
  /** How many matched trade groups tie this cluster together. */
  readonly matchedGroups: number;
  readonly matchedTrades: number;
  readonly symbols: readonly string[];
  readonly firstSeen: Date;
  readonly lastSeen: Date;
}

/**
 * Accounts joined into clusters by their shared trades.
 *
 * Union-find over the matched groups, so A-B and B-C become one cluster of
 * three. Transitivity is the point: a copier fanning into five accounts rarely
 * produces one clean five-way match, it produces overlapping pairs.
 */
export function buildClusters(
  groups: readonly MatchedTradeGroup[],
): readonly CorrelationCluster[] {
  const parent = new Map<string, string>();

  const find = (id: string): string => {
    const seen = parent.get(id);
    if (seen === undefined || seen === id) {
      parent.set(id, id);
      return id;
    }
    const root = find(seen);
    parent.set(id, root);
    return root;
  };

  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  for (const group of groups) {
    const [first, ...rest] = group.tradingAccountIds;
    if (!first) continue;
    for (const other of rest) union(first, other);
  }

  const byRoot = new Map<string, MatchedTradeGroup[]>();
  for (const group of groups) {
    const first = group.tradingAccountIds[0];
    if (!first) continue;
    const root = find(first);
    const bucket = byRoot.get(root);
    if (bucket) bucket.push(group);
    else byRoot.set(root, [group]);
  }

  return [...byRoot.values()]
    .map((clusterGroups) => {
      const accounts = new Set<string>();
      const symbols = new Set<string>();
      let firstSeen = clusterGroups[0]!.openedAt;
      let lastSeen = clusterGroups[0]!.openedAt;

      for (const group of clusterGroups) {
        for (const id of group.tradingAccountIds) accounts.add(id);
        symbols.add(group.symbol);
        if (group.openedAt < firstSeen) firstSeen = group.openedAt;
        if (group.openedAt > lastSeen) lastSeen = group.openedAt;
      }

      return {
        tradingAccountIds: [...accounts],
        matchedGroups: clusterGroups.length,
        matchedTrades: clusterGroups.reduce((total, g) => total + g.tradeIds.length, 0),
        symbols: [...symbols],
        firstSeen,
        lastSeen,
      };
    })
    .sort((a, b) => b.tradingAccountIds.length - a.tradingAccountIds.length);
}

export interface ClusterExposure {
  readonly tradingAccountIds: readonly string[];
  /** Combined remaining lifetime capacity. Null if any member is uncapped. */
  readonly combinedRemainingCapMinor: bigint | null;
  readonly combinedEquityMinor: bigint;
  readonly combinedOpenMicroEquivalents: number;
}

/**
 * What a cluster could cost the firm if every member paid out.
 *
 * A single uncapped member makes the combined figure unbounded, so the whole
 * cluster reports null rather than the sum of the others. Reporting a finite
 * number for an unbounded exposure is the error worth avoiding here.
 */
export function clusterExposure(
  cluster: CorrelationCluster,
  accounts: ReadonlyMap<
    string,
    {
      remainingLifetimeCapMinor: bigint | null;
      equityMinor: bigint;
      openMicroEquivalents: number;
    }
  >,
): ClusterExposure {
  let combinedCap: bigint | null = 0n;
  let combinedEquity = 0n;
  let combinedPositions = 0;

  for (const id of cluster.tradingAccountIds) {
    const account = accounts.get(id);
    if (!account) continue;
    if (account.remainingLifetimeCapMinor === null) combinedCap = null;
    else if (combinedCap !== null) combinedCap += account.remainingLifetimeCapMinor;
    combinedEquity += account.equityMinor;
    combinedPositions += account.openMicroEquivalents;
  }

  return {
    tradingAccountIds: cluster.tradingAccountIds,
    combinedRemainingCapMinor: combinedCap,
    combinedEquityMinor: combinedEquity,
    combinedOpenMicroEquivalents: combinedPositions,
  };
}

// ---------------------------------------------------------------------------
// Same-owner signals
// ---------------------------------------------------------------------------

export type OwnerSignalKind = 'SAME_USER' | 'SAME_POSTAL_ADDRESS' | 'SAME_EMAIL_DOMAIN';

export interface OwnerLinkedAccount {
  readonly tradingAccountId: string;
  readonly userId: string;
  readonly normalisedAddress: string | null;
  readonly emailDomain: string | null;
}

export interface OwnerSignal {
  readonly kind: OwnerSignalKind;
  readonly value: string;
  readonly tradingAccountIds: readonly string[];
}

/**
 * Accounts that appear to share control.
 *
 * A shared email domain is the weakest of these by a distance — everyone at
 * gmail.com shares one — so it is reported as its own kind and left for a human
 * to weigh rather than being scored into a single number alongside the others.
 *
 * IP address and device fingerprint are NOT here: no column records them yet.
 * They are the two strongest signals of this kind, and their absence is why
 * this function is weaker than it could be.
 */
export function findOwnerSignals(
  accounts: readonly OwnerLinkedAccount[],
  options: { includeEmailDomain?: boolean } = {},
): readonly OwnerSignal[] {
  const signals: OwnerSignal[] = [];

  const group = <K extends string | null>(
    key: (account: OwnerLinkedAccount) => K,
    kind: OwnerSignalKind,
  ) => {
    const buckets = new Map<string, string[]>();
    for (const account of accounts) {
      const value = key(account);
      if (value === null || value === '') continue;
      const bucket = buckets.get(value);
      if (bucket) bucket.push(account.tradingAccountId);
      else buckets.set(value, [account.tradingAccountId]);
    }
    for (const [value, ids] of buckets) {
      if (ids.length > 1) signals.push({ kind, value, tradingAccountIds: ids });
    }
  };

  group((a) => a.userId, 'SAME_USER');
  group((a) => a.normalisedAddress, 'SAME_POSTAL_ADDRESS');
  if (options.includeEmailDomain) group((a) => a.emailDomain, 'SAME_EMAIL_DOMAIN');

  return signals;
}

/** Whitespace and case folded, so "1 Example St " and "1 example st" match. */
export function normaliseAddress(parts: {
  addressLine1: string | null;
  postalCode: string | null;
  countryCode: string | null;
}): string | null {
  // Each part is normalised BEFORE joining. Folding whitespace on the joined
  // string leaves it around the separators, so "1 Example St " and
  // "1 Example St" would produce different keys and two accounts at one address
  // would not be linked.
  const joined = [parts.addressLine1, parts.postalCode, parts.countryCode]
    .map((part) => (part ?? '').toLowerCase().replace(/\s+/g, ' ').trim())
    .filter((part) => part !== '')
    .join('|');
  return joined === '' ? null : joined;
}
