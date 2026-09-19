/**
 * Push the schema using a DIRECT database connection.
 *
 * Hosted Postgres hands out a pooled URL by default: Neon's `DATABASE_URL`
 * points at its pgbouncer endpoint, Vercel Postgres does the same. That is the
 * right connection for serving requests and the wrong one for schema changes —
 * pgbouncer in transaction mode breaks the advisory locks and prepared
 * statements a migration needs, so `prisma db push` fails or hangs against it.
 *
 * Every one of these providers also exposes the unpooled endpoint under a
 * second variable. Use it for the push, and leave DATABASE_URL alone so the
 * running application still gets the pooled connection it wants.
 */
import { spawnSync } from 'node:child_process';

const DIRECT_URL_KEYS = [
  'DIRECT_DATABASE_URL', // explicit override, if someone sets one
  'DATABASE_URL_UNPOOLED', // Neon
  'POSTGRES_URL_NON_POOLING', // Vercel Postgres
];

function findDirectUrl() {
  const named = DIRECT_URL_KEYS.map((key) => [key, process.env[key]]).find(
    ([, value]) => value && value.trim() !== '',
  );
  if (named) return named;

  // Hosted integrations let you rename the variables they inject (Neon calls it
  // a "custom prefix"), so the exact key is not knowable in advance. The suffix
  // is: whatever the prefix, the unpooled endpoint keeps it.
  return Object.entries(process.env).find(
    ([key, value]) =>
      /_URL_UNPOOLED$|_URL_NON_POOLING$/.test(key) && value && value.trim() !== '',
  );
}

const direct = findDirectUrl();

const env = { ...process.env };

if (direct) {
  const [key, value] = direct;
  console.log(`Using ${key} for the schema push (DATABASE_URL is pooled).`);
  env.DATABASE_URL = value;
} else if (/-pooler\.|pgbouncer=true/i.test(process.env.DATABASE_URL ?? '')) {
  console.warn(
    '\n  WARNING: DATABASE_URL looks pooled but no direct URL was found.\n' +
      '  If this push fails or hangs, set DIRECT_DATABASE_URL to the unpooled\n' +
      '  connection string from your database provider.\n',
  );
}

/*
 * A push that would drop a populated column needs permission.
 *
 * The rule follows APP_MODE, the same way the seed does:
 *
 *   DEMO       -> accepted automatically. A demo database holds fixtures that
 *                 this very build is about to reseed. Failing the deploy to
 *                 protect throwaway data would mean every column rename takes
 *                 the site down until somebody notices, which is exactly what
 *                 happened here.
 *   otherwise  -> refused, unless ALLOW_DB_DATA_LOSS=1 is set deliberately for
 *                 that one deploy. Silently dropping a column of a real
 *                 customer database during a build is not a thing that should
 *                 be possible.
 */
const mode = (process.env.APP_MODE ?? 'DEMO').toUpperCase();
const allowLoss = mode === 'DEMO' || process.env.ALLOW_DB_DATA_LOSS === '1';

const args = ['prisma', 'db', 'push', '--skip-generate'];
if (allowLoss) {
  console.warn(
    mode === 'DEMO'
      ? '\n  APP_MODE=DEMO: accepting data loss on the demo database, which this build reseeds.\n'
      : '\n  ALLOW_DB_DATA_LOSS=1: this push may drop columns or tables.\n',
  );
  args.push('--accept-data-loss');
} else {
  console.log(
    `\n  APP_MODE=${mode}: a push that would drop data will be refused.\n` +
      '  Set ALLOW_DB_DATA_LOSS=1 for this deploy if that is what you intend.\n',
  );
}

const result = spawnSync('npx', args, {
  stdio: 'inherit',
  env,
});
process.exit(result.status ?? 1);
