# Deploying to Vercel

This is the exact set of answers for the Vercel "New Project" screen, and why
each one is what it is.

## Before you click Deploy: you need a Postgres database

Development runs on SQLite (`file:./dev.db`). That cannot work on Vercel — the
filesystem is ephemeral and read-only at runtime, so every write (an order, a
session, a payout request) would fail or silently vanish between requests.

Create the database first:

**Vercel dashboard → Storage → Create Database → Neon** (or Vercel Postgres),
attach it to this project. Vercel injects `DATABASE_URL` automatically. Any
other Postgres host works too — you just paste the connection string yourself.

**Not Prisma Postgres.** The marketplace integration of that name sets
`DATABASE_URL` to a `prisma+postgres://` Accelerate URL, which needs the
Accelerate driver adapter this application does not use. The build rejects that
URL rather than falling through to SQLite.

If `DATABASE_URL` is missing or SQLite, the build fails on purpose. A warning
would let a deployment go live that builds cleanly and then loses every write.

The Prisma schema adapts on its own: `scripts/set-db-provider.mjs` reads the
scheme of `DATABASE_URL` at build time and rewrites the datasource provider, so
`file:./dev.db` stays SQLite locally and `postgres://…` builds a Postgres schema
on Vercel. Nothing to edit by hand.

## Framework / Build and Output Settings

| Field | Value |
|---|---|
| Framework Preset | Next.js |
| Root Directory | `./` |
| Build Command | leave the override **off** |
| Output Directory | leave the override **off** |
| Install Command | leave the override **off** |

Leave all three toggles alone. Vercel runs the `vercel-build` script from
`package.json` when one exists, which is already:

```
set-db-provider → prisma generate → prisma db push → seed (DEMO only) → next build
```

`prisma db push` runs **without** `--accept-data-loss`: a schema change that
would drop a populated column fails the build instead of quietly destroying
rows. When that happens, write a real migration rather than forcing it through.

## Environment Variables

### Set these

| Key | Value |
|---|---|
| `APP_MODE` | `DEMO` |
| `DATABASE_URL` | your Postgres URL (auto-injected if you used Vercel Storage) |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `CREDENTIAL_ENCRYPTION_KEY` | `openssl rand -base64 48` — a **different** value |
| `APP_BASE_URL` | **skip it** — Vercel's own `VERCEL_URL` is used automatically. Set it only for a custom domain. |

`APP_MODE=DEMO` is not a placeholder to upgrade when you feel ready. `PRODUCTION`
refuses to boot without a real payment provider, a real trading provider and a
real email provider, because a mock in production takes real money through a
fake checkout and provisions nothing. `SANDBOX` is the middle step, once you
have provider test credentials.

The two secrets must differ. Reusing one value means a single leak opens both
sessions and stored platform credentials.

`SESSION_SECRET` is required even in `DEMO` once the app is hosted. The built-in
demo fallback is a constant in this public repository — serving it from a
reachable hostname lets anyone forge a session cookie, the admin console
included. The app refuses to boot rather than do that, so the deploy will fail
visibly if you skip it.

### Leave these blank

`PAYMENTS_PUBLIC_KEY`, `PAYMENTS_SECRET_KEY`, `PAYMENTS_WEBHOOK_SECRET`,
`TRADOVATE_BASE_URL`, `TRADOVATE_API_KEY`, `SMTP_URL`.

Blank selects the clearly-labelled mocks. **Setting them selects the real
adapters, which are not implemented and throw by design** — that is deliberate,
so a half-configured deploy fails visibly instead of pretending to charge cards
or open funded accounts.

### Optional

`COMPANY_NAME`, `COMPANY_LEGAL_ENTITY`, `COMPANY_JURISDICTION`,
`COMPANY_SUPPORT_EMAIL`, `COMPANY_POSTAL_ADDRESS`.

Fill them in when the entity is real. Until then they stay unset and the launch
gate stays closed — the legal documents cannot be finalised with a placeholder
counterparty on them.

## After the first deploy

In `DEMO` the build seeds the catalog and a fixture account in every risk state,
so the pricing page, the dashboard and the admin console all have something to
show. Those demo logins are fixtures with a known password; the seed does not
run in `SANDBOX` or `PRODUCTION`.

## What this deployment is not

A `DEMO` deploy is a look-and-feel and workflow preview. It takes no money,
opens no trading accounts, sends no email (mail lands in the outbox table), and
must not be presented to customers as a live service.
