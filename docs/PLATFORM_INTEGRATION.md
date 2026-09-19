# Connecting Tradovate and Rithmic

Researched 2026-09-19. Sources at the foot. **Nothing here has been tested
against either vendor** — no credentials were held, no call was made, and the
vendors' own documentation sites were not reachable from the build environment.
What follows comes from search results and secondary sources, so treat every
endpoint name as a lead to verify rather than a fact to code against.

The short version: **they are not two versions of the same thing.** Tradovate is
a REST partner API built for exactly this use case. Rithmic is native-library
routing infrastructure that does not open accounts at all. The work, the cost
and the timeline are different by an order of magnitude.

---

## Tradovate — confirmed from the vendor's own documentation

Read from the Tradovate Partner API introduction, 2026-09-19. These are the
vendor's statements, not results of calls we have made.

**Access needs three things together**, issued by an Evaluation Support
representative: **organization admin credentials**, an **API key**, and a
**CID** (organization id).

**Hosts — the two we use, and only those.**

| | Simulation engine | Market data |
|---|---|---|
| Production | `demo.tradovateapi.com` | `md.tradovateapi.com` |
| Staging | `demo-api.staging.ninjatrader.dev` | `md-api.staging.ninjatrader.dev` |

Tradovate publishes a third host per environment for **live trading**. Owner
decision, 2026-09-19: it is not configured, not exposed and not present in the
source at all. This business sells simulated accounts and nothing else, so there
is no circumstance in which it should hold the address of a live order-routing
endpoint — and a constant that does not exist cannot be selected by a typo, a
bad environment variable, or a future edit that means well.
`tests/platforms.test.ts` greps the config source for both live hostnames and
fails if either reappears.

**Read that table twice.** `demo.tradovateapi.com` is a *production* host that
serves the simulation engine. It is not a test environment. Production traffic
goes to `demo.` and the test environment is the staging domain. Getting this
backwards means either testing against production or running the business
against staging. The hosts are hard-coded per environment in
`src/server/config.ts` for that reason.

**Stated partner capabilities**, each of which maps onto a capability in our
provider interface:

| Tradovate says partners can | Our capability |
|---|---|
| Create organization members individually or in bulk | `createCustomerIdentity` |
| Add entitlements and subscription plans | `marketDataEntitlements` |
| Cancel entitlements, plans or trading permissions | `disableTrading` |
| Create simulation accounts individually or in bulk | `provisionSimulatedAccount` |
| Grant trading permissions to accounts | `provisionSimulatedAccount` |
| Apply and manage pre- and post-trade risk settings | `configureRisk` |
| Halt trading for a risk category or the whole organization | `disableTrading` |
| Expire manual lockouts a trader set on themselves | `disableTrading` |
| Subscribe to real-time events over WebSocket | `authoritativeEquityStream` |

Also stated: "relaxed REST" — POST when sending a JSON body, GET when not; all
responses JSON. Privileged creation and update commands are the part of Trader
that is *not* exposed to ordinary API users, which is precisely what partner
access unlocks.

**Nothing above is VERIFIED in this codebase**, and that is not pedantry.
VERIFIED here means documentation *and* a successful call. We have the first
and none of the second, so every capability still throws.

## Tradovate — the practical path

Tradovate publishes a **Partner API** aimed at prop firms, at
`partner.tradovate.com`. The shape reported by its documentation:

| Step | What is reported |
|---|---|
| Register | Register as a partner; Tradovate issues an **API key**. |
| Authenticate | Exchange the key for an access token, sent as a bearer token. Tokens expire after **90 minutes**; cache and refresh at ~85. |
| Conformance | A staged conformance process, beginning with authentication. |
| Go live | A separate **production API key**, to be beta tested for **at least a week** before real traffic. |
| Create traders | Create users individually or in bulk; `/user/createEvaluationAccounts` is reported to create accounts and assign them to users by id. Batched endpoints are preferred over per-user calls. |
| Entitlements | `addEntitlementSubscription` assigns the T-Prop entitlement — **only after the user has signed Tradovate's non-professional Market Data Agreement**. |

### What that means for us

- The credential flow in this codebase already assumes **show-once** delivery
  and never a reusable emailed password. Confirm what Tradovate actually
  returns — an invitation, a token, or a password — and keep the
  `accessDelivery` union honest about it.
- **The market data agreement is a second signature, with Tradovate, not us.**
  Our checkout collects one signature for our own documents. Where the trader
  signs Tradovate's agreement, and what the account looks like between purchase
  and that signature, is an unanswered product question. It is the single most
  likely cause of a stuck "paid but not tradeable" account.
- Every capability in `src/server/providers/trading/tradovate.ts` stays
  `UNVERIFIED` until a real call is made against a real key. The adapter throws
  rather than returning a plausible success.

## Rithmic — a different kind of project

Two facts decide this, and neither is about access:

1. **Rithmic does not issue trader accounts.** It is broker- and FCM-neutral
   infrastructure. The broker, FCM or funding evaluator opens the account and
   issues the credentials. So "check out, get a Rithmic sign-in" requires a
   third party in the middle who is not Rithmic.
2. **R | API+ is a C++ and .NET library, not a REST API.** It cannot be called
   from this Node application at all. Reaching it means building a separate
   service in a supported language that speaks R | API+ and exposes an internal
   interface — that service is the adapter, not a file in this repository.

The reported process: contact Rithmic with company details and the API flavours
needed, receive the dev kit, build against **Rithmic Test** (no conformance
needed to connect), then submit for **conformance** before any production or
paper connection. Live credentials come from the FCM or broker afterwards.

`src/server/providers/trading/rithmic.ts` therefore marks
`provisionSimulatedAccount`, `secureCredentialDelivery`, `createCustomerIdentity`
and `adjustSimBalance` as **UNSUPPORTED** rather than UNVERIFIED. They are not
one contract away.

### If you want Rithmic sooner

There are middleware vendors selling Rithmic integration to prop firms. That
swaps a build for a dependency and a revenue share, and it puts a third party
between you and the risk engine that decides whether an account is breached.
Worth pricing, worth being deliberate about.

---

## What is built already

- The customer **chooses a platform at checkout**, inside the signed form, so
  the record of what was agreed says which platform it was agreed for.
- The choice is stored on the **order** and on the **trading account**, and
  frozen into the order's terms snapshot.
- `getTradingProvider(platform)` returns the adapter for that platform, and
  every provider call that acts on an account routes through the account's own
  platform. Acting on the wrong adapter is worse than not acting.
- In production, `createOrder` refuses any order while `PLATFORMS` is EXTERNAL,
  naming what is outstanding for the platform chosen.
- In demo mode both platforms resolve to the mock provider, which issues
  show-once demo credentials. That is a demonstration of the flow, not evidence
  either integration works.

## What is NOT built, and must not be faked

- No call to either vendor.
- No credential issuance that would survive contact with a real platform.
- No claim on the public site that either platform is connected. `/platform`
  says Tradovate is planned and unverified; keep it that way until a real
  account has been created through a real key.

---

## Sources

- https://partner.tradovate.com/ — Tradovate Partner API introduction
- https://partner.tradovate.com/overview/prop-firm-management/create-and-manage-users
- https://partner.tradovate.com/overview/quick-setup/auth-overview
- https://partner.tradovate.com/overview/conformance-testing/stage-1-authentication
- https://support.tradovate.com/s/article/Tradovate-API-Access
- https://prop.tradovate.com/ — Tradovate for prop firms
- https://www.rithmic.com/products/api-suite — R | API+
- https://www.rithmic.com/products/r-trader-pro
- https://www.quantlabsnet.com/post/what-is-a-rithmic-api-conformance-test
- https://github.com/nautechsystems/nautilus_trader/issues/3768 — R-protocol adapter discussion
