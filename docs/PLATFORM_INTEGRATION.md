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

### Getting access, in order

This is the part nobody can do from inside a codebase, and step 1 gates
everything else.

| # | Step | Who |
|---|---|---|
| 1 | **Partner account access to the Tradovate Dashboards.** Requested from an Evaluation Support representative. | Owner |
| 2 | **Create API credentials — a key AND a secret — inside Dashboards.** They are generated there, not handed over. | Owner |
| 3 | Note the **CID** (organization id) that comes with partner access. | Owner |
| 4 | Set `TRADOVATE_ENVIRONMENT`, `TRADOVATE_API_KEY`, `TRADOVATE_API_SECRET`, `TRADOVATE_CID`. | Owner |
| 5 | Write the calls: token exchange, create user, create simulation account, apply and read back risk, WebSocket subscription. | Engineering |
| 6 | Conformance testing, beginning with authentication. | Both |
| 7 | Production key, beta tested at least a week before real orders. | Both |

Tradovate also lists a development environment and an HTTP client as
prerequisites. Both already exist here — this is a Node application with an
HTTP client — so they need nothing from you.

A partial credential set is treated as **unconfigured**: the mock provider stays
in place and `getConfig().providers.trading.missing` names exactly which
variables are absent, rather than a bare "not configured" that sends someone
hunting. The **secret never lands on the config object** — only the fact of its
absence does — because config is passed into views, logged, and occasionally
serialised into a page. The adapter reads it from the environment at the point
of use.

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

### The adapter is written, from the specification

The official OpenAPI spec is checked in at `docs/vendor/tradovate-openapi.json`
(341 paths, server `https://demo.tradovateapi.com/v1`). The adapter in
`src/server/providers/trading/tradovate.ts` is written against it — every path,
field and enum value comes from that file, none is guessed.

Those capabilities are marked **DOCUMENTED**, a level that sits between
UNVERIFIED and VERIFIED and means: written from the spec, never run against a
key. It behaves differently by environment on purpose — **it runs outside
production, and refuses inside it.** That is the only way code like this can
ever be exercised and promoted; a capability that refuses everywhere never gets
tested, and one that runs everywhere gets tested on a customer.

| Operation | Endpoint |
|---|---|
| Authenticate | `POST /auth/accesstokenrequest`, token cached and renewed before 90 minutes |
| Create the trader | `POST /user/createevaluationusers` |
| Create the account | `POST /user/createevaluationaccounts` |
| Apply risk | `POST /userAccountAutoLiq/update`, `POST /userAccountPositionLimit/create` |
| Read risk back | `GET /userAccountAutoLiq/item` |
| Snapshot | `POST /cashBalance/getcashbalancesnapshot`, `GET /position/list` |
| Stop trading | `POST /userAccountAutoLiq/update` with `doNotUnlock` |
| Flatten | `POST /order/liquidatepositions` |

**The risk model maps exactly.** `dailyLossAutoLiq` is our daily loss limit,
`trailingMaxDrawdown` our drawdown allowance, and `trailingMaxDrawdownMode`
takes `EOD` or `RealTime`.

**We send `RealTime`.** Our published rule is a threshold that follows equity
intraday including unrealized gains. `EOD` measures only at the close: a
materially looser product that several competitors sell, and sending it would
mean the site says one thing while the platform enforces another. A test fails
if `EOD` ever appears.

`trailingMaxDrawdownLimit` is where the threshold stops rising. We do not send
one, because the owner's rule is that it never stops.

**Two things are deliberately still refused.** `adjustSimBalance` — deducting a
paid reward from the simulated balance — is the one operation where a silent
failure means real cash left the business and the simulated profit was never
taken back, and no endpoint in the spec is unambiguously that. And no password
is ever sent on user creation, though the spec allows one: this system does not
hold reusable platform credentials, and inventing one would put it in our
memory, our logs and our error reports.

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
- **The market data agreement is a second signature, with Tradovate, not us —
  and it is signed IN TRADOVATE.** Owner decision, 2026-09-19: the trader signs
  it on first sign-in to Tradovate. Our checkout does not collect it and must
  never appear to.

  That decision has a consequence the product has to carry rather than hide:
  there is a real state where the account is paid for, provisioned, risk-limited
  and "active" on our side, and still cannot receive market data because the
  trader has not signed Tradovate's agreement yet. We cannot complete that step
  and we cannot observe it until the entitlement API is wired up.

  So it is shown as a step we do not own. The platform chooser at checkout says
  it before purchase, the "what happens next" list says it after, and the
  provisioning status page carries it as a final step that is **never marked
  done** — because marking it done would be a claim about something happening
  inside someone else's system. When the real adapter exists, the
  `marketDataEntitlements` capability is what turns that from an instruction
  into an observed fact.
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
