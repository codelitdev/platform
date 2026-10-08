---
"@codelitdev/billing": minor
---

The engine now owns the lifecycle mechanics that products re-implemented (ADR 0011).

- `runReconciliationBatch` first queues stuck checkouts, interrupted plan changes, and subscriptions not reconciled recently. Thresholds are set with `createBilling({ reconciliation })`; pass `discover: false` to skip.
- A cancellation scheduled for the period end stops counting as paid once `paidThroughAt` passes. `commercialState` re-checks the clock, `runDeadlineBatch` releases the subscription and queues a reconciliation, and `startCheckout` releases a lapsed entitlement itself.
- `commercialState(entityId, { transaction })` reads inside the caller's transaction; the Drizzle store locks the rows it reads.
- `cancel`, `resumeCancellation`, and `startPlanChange` read the subscription back from the provider, so read models update before the webhook arrives.
- `billing.store` is internal.

**Product changes for this release**

- Remove product sweeps that query billing tables to queue reconciliation, and product expiry checks for paid access.
- Decide paid access from `commercialState`, inside your transaction when you reserve quota, instead of copying it into product tables or reading billing tables.
- Stop reading or writing billing state through `billing.store`.
- Custom `BillingStore` implementations must add `listUnreconciledSubscriptions`, `listStuckCreatingCheckouts`, `listStuckPlanChanges`, and `runInTransaction`.
