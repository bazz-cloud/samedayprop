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

const direct = DIRECT_URL_KEYS.map((key) => [key, process.env[key]]).find(
  ([, value]) => value && value.trim() !== '',
);

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

const result = spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
  stdio: 'inherit',
  env,
});
process.exit(result.status ?? 1);
