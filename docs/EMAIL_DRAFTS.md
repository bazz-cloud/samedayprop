# Customer email drafts

> GENERATED FILE. Do not edit by hand — edit `src/server/email/templates.ts`
> and re-run `npx tsx scripts/render-emails.mjs`. This file is the templates, so
> approving wording here approves what actually sends.

Figures shown are examples. In a real message every one is computed from the
same plan and account data the site renders, so an email cannot state a rule
the engine does not enforce.

`[COMPANY LEGAL NAME]` and `[SUPPORT EMAIL]` resolve from configuration and are
placeholders until the company details are supplied.

## What is deliberately absent

- **No password, ever.** The credentials email carries the username and a link;
  the secret is shown once in the dashboard and only a hash is kept. Two tests
  enforce this, one of which checks no template can even accept a password.
- **No arrival promise.** Payout mail says money was *sent*, never when it will
  land. Eligibility is ours; settlement is the bank’s.
- **No earnings claims, guarantees, or "funded trader" language.**
- **No unsubscribe link.** These are transactional. Offering to unsubscribe
  from a payout confirmation would be worse than useless.

---

## Account purchased

*After payment clears and the agreements are signed.*

**Subject:** Your $50,000 simulated account — order BRF-10428

**Attachments:** agreements.pdf — Every document you signed, with hashes

```text
Dana Reyes,

Your $50,000 simulated account is paid for and is being set up.

Paid: $449.25
Order: BRF-10428

This was a one-time charge. Nothing renews, and no card is kept on file.

Your signed agreements are attached as a single PDF. Each document inside
it is identified by version and by a SHA-256 hash of its exact text, so
what you agreed to can be verified later.

Your platform sign-in arrives in a separate message once the account is
created and its limits have been applied and read back. We do not enable
trading until those limits are confirmed.

Track it here: https://bullrushfutures.com/dashboard

—
[COMPANY LEGAL NAME]
Questions: [SUPPORT EMAIL]

All trading in this program is simulated. Account sizes are nominal figures,
not cash held for you. You can lose the fee you pay and receive nothing.
This is a service message about your account, not marketing.
```

## Credentials issued

*Once the account exists and its limits have been read back.*

**Subject:** Your platform sign-in is ready

```text
Dana Reyes,

Your $50,000 account is live and your platform sign-in is ready.

Username: BRF-80D4D2DD

Your password is NOT in this email. We show it once, in your dashboard, and
keep only a hash of it afterwards — so we cannot email it to you, and
neither can anyone who reads your mail.

Collect it here: https://bullrushfutures.com/dashboard

If you lose it we issue a new one. We cannot recover the old one.

Nobody from this company will ever ask you for your password.

—
[COMPANY LEGAL NAME]
Questions: [SUPPORT EMAIL]

All trading in this program is simulated. Account sizes are nominal figures,
not cash held for you. You can lose the fee you pay and receive nothing.
This is a service message about your account, not marketing.
```

## Daily loss lockout

*When the daily loss limit pauses trading.*

**Subject:** Trading paused until the next session

```text
Dana Reyes,

Your $50,000 account reached its daily loss limit, so open
positions were flattened and trading is paused.

Daily loss limit: $595.00
Session result:   −$612.40
Trading reopens:  18:00 ET today

This is a pause, not a breach. The account is intact, your balance is
unchanged by this, and no reset is needed — it lifts by itself.

Withdrawals are not counted as trading losses. If you withdrew today, that
did not contribute to this limit.

https://bullrushfutures.com/dashboard

—
[COMPANY LEGAL NAME]
Questions: [SUPPORT EMAIL]

All trading in this program is simulated. Account sizes are nominal figures,
not cash held for you. You can lose the fee you pay and receive nothing.
This is a service message about your account, not marketing.
```

## Account breached

*When a trailing or max drawdown breach ends the account.*

**Subject:** Your $50,000 account has ended

```text
Dana Reyes,

Trading on your $50,000 account has ended. It reached the trailing drawdown threshold.

Equity at that point: $48,200.00
Threshold:            $48,200.00
When:                 19 Sep 2026, 14:32 ET

Equity touching the threshold is a breach, not only falling below it.

The full record — every equity observation, the threshold at each one, and
the event that ended the account — is on your dashboard. If you think this
is wrong, reply to this email and we will look at that record with you.

Starting again costs $439.25 as a reset, which is less than a new
account. A reset restores the balance, the high-water mark and the
threshold. It does NOT restore payout capacity you have already used.

The fee you paid is not refunded.

https://bullrushfutures.com/dashboard

—
[COMPANY LEGAL NAME]
Questions: [SUPPORT EMAIL]

All trading in this program is simulated. Account sizes are nominal figures,
not cash held for you. You can lose the fee you pay and receive nothing.
This is a service message about your account, not marketing.
```

## Payout requested

*On a valid payout request.*

**Subject:** Payout request received — $250.00

```text
Dana Reyes,

We have your payout request.

Gross withdrawal: $500.00
Cash to you:      $250.00
Reference:        PO-3391

Your simulated balance has been reduced by $500.00. The other half
is not paid to anyone — it is simulated balance that ceases to exist.

Eligibility, processing and settlement are three different things. We
cannot promise when the money lands: that depends on the payment rails,
your verification status and banking cut-off times.

You can see which stage this request is at here: https://bullrushfutures.com/dashboard

—
[COMPANY LEGAL NAME]
Questions: [SUPPORT EMAIL]

All trading in this program is simulated. Account sizes are nominal figures,
not cash held for you. You can lose the fee you pay and receive nothing.
This is a service message about your account, not marketing.
```

## Payout paid

*When the cash has been sent.*

**Subject:** Payout sent — $250.00

```text
Dana Reyes,

$250.00 has been sent.

Reference: PO-3391
Sent:      19 Sep 2026

Remaining lifetime payout capacity: $8,750.00

Sent is not the same as arrived. When it reaches your account depends on
your bank and the payment rail, not on us.

https://bullrushfutures.com/dashboard

—
[COMPANY LEGAL NAME]
Questions: [SUPPORT EMAIL]

All trading in this program is simulated. Account sizes are nominal figures,
not cash held for you. You can lose the fee you pay and receive nothing.
This is a service message about your account, not marketing.
```

## Inactivity warning

*At 60 and again at 83 days without a trade.*

**Subject:** Your $50,000 account closes on 18 Dec 2026

```text
Dana Reyes,

Your $50,000 account has had no trading activity for
60 days. Accounts close after 90 days without a trade.

This one closes on 18 Dec 2026 unless you place a trade before then.
A single trade resets the clock.

Closing for inactivity does not refund the fee. It does not forfeit a
payout you have already requested and become eligible for.

https://bullrushfutures.com/dashboard

—
[COMPANY LEGAL NAME]
Questions: [SUPPORT EMAIL]

All trading in this program is simulated. Account sizes are nominal figures,
not cash held for you. You can lose the fee you pay and receive nothing.
This is a service message about your account, not marketing.
```

## Reset purchased

*After a paid reset is applied.*

**Subject:** Your $50,000 account is reset

```text
Dana Reyes,

Your $50,000 account has been reset and can trade again.

Paid:              $439.25
Balance restored:  $50,000.00
Payout capacity:   $8,750.00 remaining

Your high-water mark and trailing threshold were restored with the balance.

Payout capacity you had already used was NOT restored. A reset returns the
account to its starting state; it does not return the money you were paid.

You keep the same platform sign-in.

https://bullrushfutures.com/dashboard

—
[COMPANY LEGAL NAME]
Questions: [SUPPORT EMAIL]

All trading in this program is simulated. Account sizes are nominal figures,
not cash held for you. You can lose the fee you pay and receive nothing.
This is a service message about your account, not marketing.
```
