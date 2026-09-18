# Operations

Incidents, retries, reconciliation, backups and access control.

---

## Running it

```bash
npm install
npm run setup     # generate client, create the database, seed fixtures
npm run dev       # web app on :3000
npm run worker    # background worker — run in a second terminal
```

The worker is not optional. Provisioning, account syncing, payout submission and
reconciliation all run there, so a customer's HTTP request never waits on an
external provider.

## Modes

| Mode | Payments | Trading | Email | Real money |
|---|---|---|---|---|
| `DEMO` | mock | mock | local outbox | no |
| `SANDBOX` | provider sandbox | provider sandbox | configured | no |
| `PRODUCTION` | live | live | live | **yes** |

`getConfig()` **refuses to start in PRODUCTION** without a configured payment
provider, trading provider and email provider. A mock in production would take
real money through a fake checkout and provision nothing.

Separate databases and credentials per mode. Never point a non-production mode
at the production database.

## Background jobs

DB-backed durable queue (`Job` table). Claiming is a conditional
`PENDING → CLAIMED` update, so two workers racing produce exactly one winner
without a distributed lock.

- Retries: exponential backoff 2s, 4s, 8s, 16s, 32s, capped at 60s.
- After `maxAttempts` (default 5) a job is marked `DEAD` and surfaced in `/admin`.
- Jobs claimed for over 5 minutes are reclaimed by `recoverStaleClaims()` — this
  is what recovers work from a worker that died mid-run.
- Enqueue is idempotent on `idempotencyKey`.

Job kinds: `PROVISION_ACCOUNT`, `VERIFY_RISK_CONFIG`, `SYNC_ACCOUNT`,
`SUBMIT_PAYOUT`, `RECONCILE_PAYOUT`, `RECONCILE_PROVIDER_BALANCES`,
`SEND_EMAIL`, `ROLL_TRADING_SESSION`.

## Idempotency

Every externally-triggered write has a `UNIQUE` idempotency key:

| Operation | Key | Protects against |
|---|---|---|
| Order creation | client-supplied | double-submitted checkout |
| Payment application | `payment:{orderId}` | replayed webhook |
| Webhook delivery | `UNIQUE(source, externalId)` | duplicate delivery |
| Provisioning | `provision:{orderId}` | two identities for one order |
| Provider event | `UNIQUE(provider, account, sequence)` | duplicate/out-of-order events |
| Payout request | client-supplied | double-click reserving twice |
| Simulated deduction | `payout-deduct:{id}` | double deduction |
| Ledger entry | per-entry key | double posting |

## Incidents

### Payout with an unknown outcome

The most dangerous state in the system.

**Do not reverse the simulated deduction.** It stays applied and the capacity
stays reserved until an authoritative provider lookup confirms whether cash was
sent. Reversing on an unknown outcome can pay the same profit twice.

1. Look the payment up **at the provider**, not in our records.
2. If it was sent: `resolveReconciliation({ confirmedNotPaid: false, paymentRef })`.
3. If it was definitively not sent:
   `resolveReconciliation({ confirmedNotPaid: true, reason })` — this restores
   the simulated balance, releases the reservation, and records the compensating
   entries.
4. If the provider cannot say: leave it parked. Escalate. Do not guess.

### Paid but not provisioned

Visible in `/admin` as "Paid but not provisioned". The customer sees a truthful
pending state and has not been told an account exists.

1. Check `ProvisioningJob.lastError`.
2. Transient → re-enqueue `PROVISION_ACCOUNT`. Idempotency guarantees one
   account, not two.
3. Permanent → the job is in `manual_review`. Resolve with the provider, or
   close it out with a refund under the published policy.

### Risk configuration unverified

The account exists but its limits could not be read back. It is **not** active,
and it must not be activated manually until the limits are confirmed at the
provider. A tradeable account with unenforced limits is an uncapped liability.

### Flatten or disable not confirmed

A CRITICAL `TRADING_DISABLE_FAILED` event means we asked the provider to stop
the account and did not get confirmation. **External trading may still be
possible.** Verify manually in the provider's own interface. Do not rely on our
status display.

### Stale account data

Payouts and new exposure are blocked automatically. Investigate provider
connectivity. Do not manually clear the stale flag to unblock a payout — the
flag is what prevents acting on numbers we cannot vouch for.

### A ledger does not balance

Shown on `/admin`. This should be impossible through `postEntry()`, so a
non-zero net means an entry was written outside the ledger service or the
database was edited by hand. Treat as a data-integrity incident: stop payouts,
find the entry, correct with a **compensating entry** — never an edit or delete.

## Reconciliation

`RECONCILE_PROVIDER_BALANCES` runs each minute from the worker:

1. Re-syncs every active and paused account from the provider.
2. Verifies all four ledgers balance to zero.
3. Records findings in `ReconciliationRun`.

Non-clean runs surface in `/admin`.

## Access control

| Role | Access |
|---|---|
| `OWNER` | Everything |
| `FINANCE` | Payouts, refunds, economics |
| `SUPPORT` | Customer records, tickets |
| `RISK` | Risk events, connection health, trade disable |
| `TRADER` | Own accounts only |

- All four privileged roles require **MFA enrolled** — `requireRole()` refuses
  an admin session without it.
- Object-level authorisation is checked at every entry point, not inferred from
  a URL. Tested for cross-customer access on payouts, quotes and dashboards.
- Money-moving and rule-changing actions require a **stated reason**
  (`recordAudit` throws without one).
- `MANUAL_BALANCE_ADJUSTMENT`, `PAYOUT_FORCE_PAID`, `LIFETIME_CAP_APPROVED` and
  `LAUNCH_GATE_CHANGED` require **dual approval**, and the approver may not be
  the requester.

## Secrets and PII

- Passwords: scrypt (N=65536, r=8, p=1), per-hash parameters stored so cost can
  be raised later with transparent rehash on next login.
- Session tokens: only the SHA-256 is stored. A leaked backup cannot be used to
  impersonate anyone.
- Card details never reach this application — hosted/tokenised provider pages only.
- No password, token, session or identity-document content is ever logged.
- Platform credentials are never stored in retrievable plaintext and a reusable
  password is never emailed. Invitation or scoped-token delivery only.
- Signature evidence (IP, user agent) is restricted and subject to a retention
  policy that is **not yet set** — see `docs/LEGAL_REVIEW.md`.

## Backups

Not yet configured. Before production:

- Point-in-time recovery on the primary database.
- Ledger and audit tables are append-only; verify backups can reconstruct them.
- Test a restore, don't assume one works.
- Document RPO and RTO.

## Known advisory

`npm audit` reports one high-severity advisory in `deepmerge-ts`, reached
through `@prisma/config` in the **Prisma CLI** (a devDependency). It is not in
the runtime client, is not reachable from user input, and does not ship to
production. Re-check on each Prisma upgrade.

## Before production

See `docs/LAUNCH_CHECKLIST.md`. The live version is at `/admin`, which enforces
the gate rather than merely displaying it.
