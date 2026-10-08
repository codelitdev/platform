---
"@codelitdev/billing": minor
---

Cancelling a subscription now keeps it active until the end of the paid period (ADR 0010). Previously the Dodo adapter ended it immediately, so the customer lost the time they had paid for. `commercialState` reports `cancelAtPeriodEnd: true` and `paidThroughAt` while a cancellation is scheduled, and the new `resumeCancellation` clears it.

**Product changes for this release**

- Show the end date from `commercialState().paidThroughAt` when `cancelAtPeriodEnd` is true, and offer to resume.
- Resume with `billing.resumeCancellation({ grant, entity, payer })`, using a `cancellation` grant. Do not start a new checkout while the subscription is still active.
- Custom provider adapters must implement `resumeSubscription`, and `cancelSubscription` must schedule the cancellation at period end.
