# Tradovate partner capabilities

**Status: NOTHING HAS BEEN VERIFIED.**

No Tradovate API call has been made from this codebase. No partner credentials
were supplied, no partner agreement was available, and no official documentation
was consulted during this build. Every capability below is therefore
`UNVERIFIED`, and the real adapter throws on every method.

This file exists to be filled in, not to record findings that do not exist.

---

## Why the adapter is empty on purpose

`src/server/providers/trading/tradovate.ts` implements the provider interface
and throws `CapabilityNotAvailableError` from every method.

That is a deliberate choice. Writing plausible-looking calls against guessed
endpoints would produce code that:

- looks like a working integration in review,
- passes a cursory smoke test against a mock,
- and fails against the real partner API in production, after customers have
  paid.

An adapter that refuses loudly is worth more than one that lies quietly.

## The method names are ours, not Tradovate's

`provisionAccount`, `configureRisk`, `subscribeAccountEvents`, `disableTrading`
and `adjustSimBalance` are **our internal vocabulary**. None of them asserts that
Tradovate exposes an endpoint by that name, or any endpoint with that capability
at all.

In particular: **standard retail API access must not be assumed to permit
creating other people's customer identities, provisioning simulated accounts for
them, setting partner risk parameters, or adjusting simulated balances.** Those
are partner-tier capabilities that may require a separate agreement, a separate
credential tier, or may not be available at all.

---

## Capability register

Fill in `Support`, `Evidence` and `Verified on` as each is confirmed. Change the
corresponding entry in `tradovate.ts` at the same time — the code is the
enforcement point, this table is the record.

| Capability | Support | Evidence (doc URL + section, or agreement clause) | Verified on |
|---|---|---|---|
| Create a customer identity | UNVERIFIED | — | — |
| Link an existing customer identity | UNVERIFIED | — | — |
| Provision a simulated account | UNVERIFIED | — | — |
| Unique external account identifiers | UNVERIFIED | — | — |
| Approved authentication / invitation flow | UNVERIFIED | — | — |
| Secure credential delivery (no reusable plaintext password) | UNVERIFIED | — | — |
| Market data entitlements | UNVERIFIED | — | — |
| Contractual simulation charges | UNVERIFIED | — | — |
| Supported instruments | UNVERIFIED | — | — |
| Commission schedule | UNVERIFIED | — | — |
| Risk parameter updates | UNVERIFIED | — | — |
| **Read back applied risk configuration** | UNVERIFIED | — | — |
| Authoritative equity | UNVERIFIED | — | — |
| Authoritative positions | UNVERIFIED | — | — |
| Authoritative orders and fills | UNVERIFIED | — | — |
| Account event stream | UNVERIFIED | — | — |
| Disable trading | UNVERIFIED | — | — |
| Flatten positions | UNVERIFIED | — | — |
| Daily lock | UNVERIFIED | — | — |
| Provider-side drawdown enforcement | UNVERIFIED | — | — |
| **Simulated balance deduction** | UNVERIFIED | — | — |
| Reconciliation of provider transactions | UNVERIFIED | — | — |
| Streaming reconnect behaviour | UNVERIFIED | — | — |
| Event replay after a disconnect | UNVERIFIED | — | — |
| Rate limits | UNVERIFIED | — | — |
| Sandbox vs production environments | UNVERIFIED | — | — |

Required before any production sale (`CAPABILITIES_REQUIRED_FOR_LAUNCH`):
`provisionSimulatedAccount`, `secureCredentialDelivery`, `configureRisk`,
`readBackRiskConfiguration`, `authoritativeEquityStream`, `disableTrading`,
`flattenPositions`, `adjustSimBalance`.

---

## How to verify a capability

1. Read the **current** official API documentation. Note the URL and the section.
2. Confirm the tier of access actually purchased permits it. Retail ≠ partner.
3. Make the call against the sandbox with real credentials.
4. For anything that changes state, **read it back** and confirm the change
   took effect. A 200 response is not confirmation.
5. Record the evidence in the table above with a date.
6. Change `UNVERIFIED` to `VERIFIED` or `UNSUPPORTED` in `tradovate.ts` and
   implement only the verified path.

## Capabilities that turn out to be UNSUPPORTED

An `UNSUPPORTED` result is a **product decision, not a problem to work around**.

The two that would hurt most:

- **No simulated balance deduction via API.** The payout flow depends on
  deducting the gross withdrawal from the simulated account. Without it, the
  payout saga needs a documented manual procedure with its own dual-control and
  reconciliation, and the "same-day" promise needs re-examining against the
  time a human step actually takes.
- **No provider-side risk enforcement or trade disable.** The risk engine can
  detect a breach from polled data, but it cannot *stop* trading. Marketing an
  enforced daily loss limit would then be inaccurate, and the honest options are
  to enforce it through whatever the provider does support, or to describe the
  limit accurately as post-hoc.

## Open questions for the partner conversation

1. Which API tier permits creating and managing accounts for our customers?
2. Is there a read-back endpoint for applied risk settings, or only a write?
3. What is the authoritative source of intraday equity including unrealized P&L,
   and at what latency?
4. On a disconnect, can missed events be replayed, or only a current snapshot
   re-fetched? Sequence numbering and gap detection?
5. Are simulated balance adjustments supported, idempotent, and reversible?
6. What are the contractual charges per simulated account and per market data
   entitlement, and how are they billed?
7. What happens to our risk configuration if a customer changes something on
   their side?
8. What is the rate limit, and what does the system do when we hit it during a
   breach-handling burst?
