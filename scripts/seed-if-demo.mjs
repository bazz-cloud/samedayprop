/**
 * Seed the catalog on a hosted build — but only in DEMO mode.
 *
 * The seed plants demo users with a known password and fixture accounts in
 * every risk state. That is exactly what a DEMO deployment needs (the site has
 * no plans to sell until the catalog rows exist) and exactly what must never
 * appear in SANDBOX or PRODUCTION, where those logins would be real doors.
 *
 * So: DEMO seeds, anything else skips loudly and leaves seeding to a deliberate
 * `npm run db:seed` against the right database.
 */
import { spawnSync } from 'node:child_process';

const mode = process.env.APP_MODE ?? 'DEMO';

if (mode !== 'DEMO') {
  console.log(`APP_MODE=${mode} — skipping the demo seed (run db:seed deliberately if you want it).`);
  process.exit(0);
}

console.log('APP_MODE=DEMO — seeding demo catalog and fixture accounts.');
const result = spawnSync('npx', ['tsx', 'prisma/seed.ts'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
