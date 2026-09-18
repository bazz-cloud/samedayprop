# Legal review status

**No document in this repository has been reviewed by a lawyer.** Every required
agreement is seeded with status `DRAFT_PENDING_LEGAL_REVIEW`, and the production
launch gate refuses to open while any of them is still in that status.

This file is not legal advice.

---

## Document set

All seven are required at checkout. Source text lives in
`src/server/legal/documents.ts`; each published version is stored with a SHA-256
of its exact bytes so a signature stays reproducible after later edits.

| Slug | Title | Status |
|---|---|---|
| `trader-agreement` | Trader Agreement | DRAFT |
| `simulation-and-reward-disclosure` | Simulation and Reward Disclosure | DRAFT |
| `purchase-and-refund-terms` | Purchase, Coupon and Refund Terms | DRAFT |
| `payout-policy` | Payout Policy and Program Limits | DRAFT |
| `prohibited-conduct` | Prohibited Conduct, Breach and Appeal | DRAFT |
| `privacy-and-data` | Privacy and Data Processing | DRAFT |
| `electronic-signature-consent` | Consent to Electronic Records and Signatures | DRAFT |

## Terms marked [NOT SUPPLIED]

These were not provided and have **not been guessed**. Each appears verbatim in
the drafts as `[NOT SUPPLIED — owner and counsel must complete before launch]`.

**Contract formation and disputes**
- Governing law and jurisdiction
- Dispute resolution and arbitration
- Class-action waiver
- Limitation of liability and indemnities

**Commercial**
- Refund and cancellation policy, including how a refund interacts with an
  already-provisioned account or one that has already received a reward
- Geographic eligibility and restricted countries
- Account inactivity
- Program completion and closure

**Tax**
- Jurisdiction, rate, inclusive vs exclusive treatment
- Reporting and withholding obligations for cash rewards paid to traders

**Conduct**
- The prohibited-conduct list itself (bots, news trading, cross-account hedging,
  copy trading, group trading, exploiting simulated fills, account sharing)
- Suspension process, evidence standards, notice periods, appeal route

**Data**
- Named sub-processors
- Retention periods for signature evidence and identity documents
- Which data-protection regime applies (depends on geographic eligibility)

**Identity**
- Company legal name, entity type, jurisdiction, postal address, support email

## What the drafts do assert

Written to be accurate about the product as built:

- Trading is simulated; orders do not reach a live exchange.
- The account size is nominal and is not cash held for the customer.
- The 50/50 split, with the $500 gross / $250 cash arithmetic spelled out.
- The retained buffer is **not** an evaluation target, with a worked example.
- No evaluation, no consistency rule, no minimum trading or winning days.
- Same-day **eligibility** is distinguished from same-day **receipt of funds**,
  which is not guaranteed.
- No guarantee of profits, rewards or payouts; most participants in programs of
  this kind receive nothing.
- Card details are never received or stored by this application.
- No claim of regulatory approval or registration, and no suggestion that
  operating a simulation removes obligations that may apply under law.

## Signature mechanism

- Acknowledgements render **unchecked**. Pre-ticking would make the evidence
  worthless.
- Full text is readable inline and at a permanent URL before signing.
- The signature is an affirmative act: the customer types their full legal name.
- Submit stays disabled until every document is acknowledged and a name entered.

### Evidence stored per signature

| Field | Purpose |
|---|---|
| `userId` | The authenticated account |
| `documentId` + `documentHash` | The exact text signed |
| `quoteHash` | The exact plan, rules and price signed |
| `typedLegalName` | The signature itself |
| `consentWording` | The exact wording displayed beside the field |
| `signedAt` | Timestamp |
| `ipAddress`, `userAgent` | Limited technical evidence |

**Binding to the quote hash is the important part.** If the plan, its rules or
its price changes between signing and charging, the recomputed hash differs, the
signature is treated as stale and the order is refused. The customer re-reviews
rather than being charged terms they did not agree to. Tested in
`tests/integration.test.ts`.

The download at `/api/documents/[id]/download` reproduces the stored text, not
the current version, and re-hashes it — printing an explicit warning on the copy
if the stored text no longer matches what was signed.

### Enforceability is not claimed

Both the consent document and the checkout UI state plainly that a checkbox and
a typed name create a *record of agreement*, and do not by themselves guarantee
that every term is enforceable — that depends on the governing law, which is
undecided, and on a review that has not happened.

## For counsel

Suggested order of work:

1. **Refund policy**, because it interacts with provisioning failure, and
   provisioning failure after successful payment is a real path in the system.
2. **Governing law and disputes**, because several other terms depend on it.
3. **Geographic eligibility**, because it determines the data regime.
4. **Tax**, because it changes displayed totals and possibly the payout flow.
5. **Prohibited conduct and appeal**, because it is the basis for terminating
   an account that may hold an earned payout.

Points worth specific attention:

- The 50/50 reward split means half of every gross withdrawal simply ceases to
  exist. The drafts say so explicitly; confirm that framing is right.
- The lifetime payout cap is **undecided**. Selling without one is an unbounded
  cash obligation per account.
- A pending payout is deliberately **not** cancelled by a later unrelated
  account status change. Confirm that matches the intended commercial position.
- "Same-day payout eligibility" is used throughout as a statement about rules,
  never about settlement timing.
