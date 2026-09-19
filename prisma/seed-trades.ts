/**
 * Trade fixtures for the admin console.
 *
 * DEMO FIXTURES, chosen to exercise the analytics boundaries — not business
 * statistics, and not to be read as any customer's real performance.
 *
 * Deterministic: a seeded PRNG rather than Math.random, so a screenshot taken
 * today matches one taken tomorrow and a failing assertion can be reproduced.
 *
 * Two things are constructed on purpose:
 *
 *   1. A five-account correlated cluster taking the identical MNQ short in the
 *      same second — the exact pattern the detector exists to find. Without it
 *      the detector ships untested against realistic data.
 *   2. A spread of outcomes: winners, losers, scratches and one account with
 *      no trades at all, so the empty states are visible rather than assumed.
 */

import { PrismaClient } from '../src/generated/prisma';
import { sessionDateFor, DEFAULT_SESSION_CONFIG } from '../src/domain/risk/session';

const prisma = new PrismaClient();

/** Mulberry32. Small, fast, and the same sequence on every machine. */
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const E8 = 100_000_000n;

/** Dollar value of one point, and the micro-equivalents one contract consumes. */
const INSTRUMENTS = [
  { symbol: 'MNQ', pointValueMinor: 200n, tickE8: 25_000_000n, micros: 1, basePrice: 20_125.25 },
  { symbol: 'MES', pointValueMinor: 500n, tickE8: 25_000_000n, micros: 1, basePrice: 5_712.5 },
  { symbol: 'NQ', pointValueMinor: 2_000n, tickE8: 25_000_000n, micros: 10, basePrice: 20_125.25 },
  { symbol: 'ES', pointValueMinor: 5_000n, tickE8: 25_000_000n, micros: 10, basePrice: 5_712.5 },
] as const;

const COMMISSION_PER_CONTRACT_MINOR = 62n; // $0.62 round turn

function toE8(price: number): bigint {
  return BigInt(Math.round(price * 1e8));
}

export async function seedTrades(): Promise<{ trades: number; clustered: number }> {
  const accounts = await prisma.tradingAccount.findMany({
    where: { externalAccountId: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, tradingStatus: true, startingBalanceMinor: true },
  });

  if (accounts.length === 0) return { trades: 0, clustered: 0 };

  const random = seededRandom(20260919);
  const sessionDate = sessionDateFor(new Date(), DEFAULT_SESSION_CONFIG.value);
  const now = Date.now();

  let written = 0;

  // ---- ordinary trading -----------------------------------------------------
  // The LAST account is deliberately left with no trades, so the console's
  // empty states are exercised rather than assumed to work.
  for (const [index, account] of accounts.slice(0, -1).entries()) {
    const count = 8 + Math.floor(random() * 18);

    for (let n = 0; n < count; n += 1) {
      const instrument = INSTRUMENTS[Math.floor(random() * INSTRUMENTS.length)]!;
      const side = random() > 0.45 ? 'LONG' : 'SHORT';
      const quantity = 1 + Math.floor(random() * 3);

      const entry = instrument.basePrice + (random() - 0.5) * 40;
      // Slight positive skew on winners so accounts are not uniformly losing.
      const movePoints = (random() - 0.47) * 12;
      const signedMove = side === 'LONG' ? movePoints : -movePoints;
      const exit = entry + (side === 'LONG' ? movePoints : -movePoints);

      const grossMinor =
        BigInt(Math.round(signedMove * 100)) * instrument.pointValueMinor * BigInt(quantity) / 100n;
      const commissionMinor = COMMISSION_PER_CONTRACT_MINOR * BigInt(quantity);

      const openedAt = new Date(now - (index + 1) * 3_600_000 - n * 900_000);
      const holdSeconds = 20 + Math.floor(random() * 5_400);

      await prisma.trade.create({
        data: {
          tradingAccountId: account.id,
          symbol: instrument.symbol,
          side,
          quantity,
          microEquivalents: instrument.micros * quantity,
          entryPriceE8: toE8(entry),
          exitPriceE8: toE8(exit),
          openedAt,
          closedAt: new Date(openedAt.getTime() + holdSeconds * 1000),
          status: 'CLOSED',
          realisedPnlMinor: grossMinor - commissionMinor,
          commissionMinor,
          sessionDate,
          providerTradeId: `demo-${account.id}-${n}`,
        },
      });
      written += 1;
    }
  }

  // ---- the correlated cluster ----------------------------------------------
  // Five accounts, one MNQ short, same second, same entry, same exit, same 42s
  // hold. One trader running a copier — the pattern the detector exists for.
  const clusterAccounts = accounts.slice(0, 5);
  const clusterOpenedAt = new Date(now - 45 * 60_000);
  const clusterEntry = toE8(20_125.25);
  const clusterExit = toE8(20_113.75);

  for (const [index, account] of clusterAccounts.entries()) {
    const quantity = 2;
    const grossMinor = BigInt(Math.round(11.5 * 100)) * 200n * BigInt(quantity) / 100n;
    const commissionMinor = COMMISSION_PER_CONTRACT_MINOR * BigInt(quantity);

    await prisma.trade.create({
      data: {
        tradingAccountId: account.id,
        symbol: 'MNQ',
        side: 'SHORT',
        quantity,
        microEquivalents: quantity,
        entryPriceE8: clusterEntry,
        exitPriceE8: clusterExit,
        // Sub-second stagger, well inside the +/-5s window: a copier is fast
        // but not instantaneous, and identical timestamps would be an easier
        // case than reality provides.
        openedAt: new Date(clusterOpenedAt.getTime() + index * 400),
        closedAt: new Date(clusterOpenedAt.getTime() + index * 400 + 42_000),
        status: 'CLOSED',
        realisedPnlMinor: grossMinor - commissionMinor,
        commissionMinor,
        sessionDate,
        providerTradeId: `demo-cluster-${account.id}`,
      },
    });
    written += 1;
  }

  // ---- one open position ----------------------------------------------------
  const first = accounts[0];
  if (first) {
    await prisma.trade.create({
      data: {
        tradingAccountId: first.id,
        symbol: 'MES',
        side: 'LONG',
        quantity: 2,
        microEquivalents: 2,
        entryPriceE8: toE8(5_710.25),
        exitPriceE8: null,
        openedAt: new Date(now - 12 * 60_000),
        closedAt: null,
        status: 'OPEN',
        realisedPnlMinor: 0n,
        commissionMinor: 0n,
        sessionDate,
        providerTradeId: `demo-open-${first.id}`,
      },
    });
    written += 1;
  }

  return { trades: written, clustered: clusterAccounts.length };
}

if (require.main === module) {
  seedTrades()
    .then((result) => {
      console.log(`Seeded ${result.trades} trades, including a ${result.clustered}-account cluster.`);
      return prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
