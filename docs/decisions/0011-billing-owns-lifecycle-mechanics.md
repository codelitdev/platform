# ADR 0011: The billing engine owns the remaining lifecycle mechanics

Status: accepted  
Date: 2026-10-07

## Context

Products built on `@codelitdev/billing` kept re-implementing parts of the
payment lifecycle that are mechanics, not product policy:

- Sweeps that query billing tables for stuck checkouts, interrupted plan
  changes, and subscriptions not checked with the provider, then queue
  reconciliation. `runReconciliationBatch` only processed jobs that were
  already queued, although the README described it as handling stuck work.
- Their own expiry checks for paid access, and direct writes through
  `billing.store` to release a lapsed entitlement before checkout. A
  cancellation scheduled for the period end kept `active` status and so kept
  paid access indefinitely if the provider's final event was missed.
- Copies of the paid state in product tables, or direct reads of billing
  tables, because `commercialState` could not run inside the product's own
  transaction while it reserved quota.
- A provider read after cancel or resume, so the UI did not wait for the
  webhook.

## Decision

- `runReconciliationBatch` first queues stuck work (`enqueueStuckWork`):
  checkouts still `creating`, plan changes still `creating` or `pending`
  after an error, and live subscriptions not reconciled recently. The
  thresholds are configurable through `createBilling({ reconciliation })`
  and default to one minute, one hour, and one hour. `discover: false`
  skips the step.
- `retainsPaidEntitlement` returns false once a scheduled cancellation's
  `paidThroughAt` has passed, whatever the status. `commercialState`
  re-checks the clock on every read. `runDeadlineBatch` releases such
  subscriptions and queues a reconciliation to confirm the final state with
  the provider. `startCheckout` releases a lapsed entitlement itself.
- `commercialState(entityId, { transaction })` reads inside the caller's
  open transaction. The Drizzle store locks the rows it reads until that
  transaction ends. The store gains `runInTransaction` for this.
- `cancel`, `resumeCancellation`, and `startPlanChange` read the
  subscription back from the provider after the change and project it. A
  failed read is ignored, because the webhook and reconciliation apply the
  same state later.
- `billing.store` is documented as internal. Products use workflows and read
  models.

## Consequences

- Products delete their billing sweeps, expiry checks, and paid-state
  copies, and decide what a plan unlocks from `commercialState`.
- Every live subscription is read from the provider about once per
  `subscriptionStaleAfterMs`. At the current scale this is a small number
  of requests.
- Custom `BillingStore` implementations must add `listUnreconciledSubscriptions`,
  `listStuckCreatingCheckouts`, `listStuckPlanChanges`, and
  `runInTransaction`. The in-memory store keeps no update times, so it
  treats every candidate as stuck.
