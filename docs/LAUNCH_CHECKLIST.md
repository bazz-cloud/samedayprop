# Launch readiness checklist

The live, enforced version is at `/admin`. Production checkout refuses an order
while any blocking item is open — this is a gate in the checkout service, not a
display.

**Current status: NOT READY. Real-money sales are blocked.**

---

## Blocking — must be resolved before any real customer

### A. Owner decisions

- [ ] **Lifetime cash payout cap per plan.** Approve an amount, or explicitly
      approve an uncapped policy with a written acknowledgement that the
      obligation is unbounded. The recommended $1,500/$3,000/$5,000/$6,000/
      $10,000 figures were **not** approved. *This is the single largest
      open financial exposure.*
- [ ] Approve or revise every PROPOSED risk parameter: drawdown allowance, daily
      loss limit, retained buffer, daily cash cap, for all five plans.
- [ ] Approve the trailing stop policy (starting balance + $100).
- [ ] Finalise the $300,000 position ceiling.
- [ ] Approve or revise the breach consequences.
- [ ] Decide: one active account per person, or more.
- [ ] Approve session times and the exchange/instrument holiday calendar.
- [ ] Approve per-instrument risk controls. Only ES/MES/NQ/MNQ are configured;
      CL and GC are explicitly unapproved.
- [ ] Decide add-on prices and confirm each can actually be delivered, or keep
      them disabled.
- [ ] Confirm the coupon code, validity window and usage limits.
- [ ] Set policies for bots, news trading, cross-account hedging, copy trading,
      restricted countries, refunds, inactivity and resets.

### B. Company identity

- [ ] Legal name, entity type, jurisdiction, postal address, support email.
- [ ] Logo (currently a placeholder mark).
- [ ] Set `COMPANY_*` environment variables.

### C. Legal

- [ ] Lawyer review of all seven documents.
- [ ] Complete every `[NOT SUPPLIED]` term — governing law, disputes,
      arbitration, class-action waiver, refunds, geographic eligibility, tax
      treatment, liability, retention, sub-processors.
- [ ] Move each document from `DRAFT_PENDING_LEGAL_REVIEW` to `APPROVED`.
- [ ] Set signature-evidence and identity-document retention periods.

### D. Tax

- [ ] Determine jurisdiction, rate and inclusive/exclusive treatment.
- [ ] Implement a `TaxPolicy` and mark it CONFIRMED.
- [ ] Decide reporting/withholding treatment for cash rewards paid to traders.

### E. Tradovate

- [ ] Obtain partner credentials and the agreement actually in force.
- [ ] Verify each capability in `TRADOVATE_CAPABILITIES.md` against current
      official documentation **and** a working sandbox call.
- [ ] Confirm the access tier permits creating and managing customer accounts.
- [ ] Confirm risk configuration can be **read back**, not only written.
- [ ] Confirm simulated balance deduction, its idempotency and reversibility.
- [ ] Confirm trade disable and flatten, and what confirmation looks like.
- [ ] Confirm event stream behaviour: sequencing, reconnect, replay, rate limits.
- [ ] Implement `tradovate.ts` for verified capabilities only.
- [ ] Decide what to do about any UNSUPPORTED capability — this is a product
      decision, not a workaround.

### F. Payments and payouts

- [ ] Contract a payment provider and implement the hosted/tokenised adapter.
- [ ] Implement webhook signature verification and replay protection against
      the real provider.
- [ ] Contract a **cash payout rail** and implement it. `submitPayout` currently
      applies the deduction and parks for an operator.
- [ ] Verify the unknown-outcome path against the real provider's semantics.
- [ ] Agree chargeback handling.

### G. Identity verification

- [ ] Decide whether identity verification is required, and where.
- [ ] Contract a provider and implement it, or record the decision not to.

### H. Email

- [ ] Contract a provider, configure `SMTP_URL`, implement the transport.
- [ ] Set up sending domain, SPF/DKIM/DMARC.
- [ ] Build the password reset flow, which depends on email.

### I. Infrastructure

- [ ] Move to PostgreSQL. Change the Prisma provider and run migrations.
- [ ] Separate databases and credentials for demo, sandbox and production.
- [ ] Configure point-in-time recovery and **test a restore**.
- [ ] Set `SESSION_SECRET` to a strong random value.
- [ ] Serve over HTTPS with secure cookies.
- [ ] Run the worker as a supervised process with restart-on-failure.
- [ ] Alerting on: dead jobs, unresolved payout outcomes, unprovisioned paid
      orders, stale accounts, ledger imbalance.
- [ ] Log aggregation that excludes secrets and PII.

### J. Verification before opening

- [ ] Full test suite green against the production schema.
- [ ] End-to-end rehearsal in sandbox: purchase → provision → trade → breach →
      payout → refund.
- [ ] Deliberately break provisioning and confirm the customer sees a truthful
      failure and gets a remedy.
- [ ] Deliberately produce an unknown payment outcome and rehearse the
      reconciliation runbook.
- [ ] Independent security review of auth, authorisation, webhooks and payments.
- [ ] Accessibility audit of the checkout flow.

---

## Recommended before scale

- [ ] Load-test the risk ingest path at expected account counts.
- [ ] Set enrolment limits and alert thresholds.
- [ ] Rehearse pausing new sales without withholding existing obligations.
- [ ] Model the reserve policy against the expected outstanding obligation from
      the sensitivity calculator, not against gross receipts.
- [ ] Decide who is on call, and for what.

---

## Explicitly NOT ready, and why

| Area | Status |
|---|---|
| Tradovate integration | Adapter throws on every method. Nothing verified. |
| Payments | Mock only. Moves no money. |
| Cash payouts | No rail. Parks for an operator after the simulated deduction. |
| Email | Local outbox. Nothing is sent. |
| Identity verification | `NOT_CONFIGURED`. Never fabricated as verified. |
| Legal documents | Seven drafts, none reviewed. |
| Tax | Not configured. Totals exclude any tax. |
| Commercial terms | Every plan has at least one unapproved parameter. |
| Lifetime payout caps | Undecided on all five plans. |

Nothing above should be described as launch-ready, and the application will not
let it be sold as such.
