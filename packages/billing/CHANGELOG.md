# @codelitdev/billing

## 0.4.0

### Minor Changes

- 7b4a9ad: The engine now owns the lifecycle mechanics that products re-implemented (ADR 0011).
  
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
- 7b4a9ad: Cancelling a subscription now keeps it active until the end of the paid period (ADR 0010). Previously the Dodo adapter ended it immediately, so the customer lost the time they had paid for. `commercialState` reports `cancelAtPeriodEnd: true` and `paidThroughAt` while a cancellation is scheduled, and the new `resumeCancellation` clears it. While a worker is sending a retried cancellation, `resumeCancellation` fails with a retryable `operation_conflicted`, so the cancellation cannot land after the resume.
  
  **Product changes for this release**
  
  - Show the end date from `commercialState().paidThroughAt` when `cancelAtPeriodEnd` is true, and offer to resume.
  - Resume with `billing.resumeCancellation({ grant, entity, payer })`, using a `cancellation` grant. Do not start a new checkout while the subscription is still active.
  - Custom provider adapters must implement `resumeSubscription`, and `cancelSubscription` must schedule the cancellation at period end.
- 7b4a9ad: `createDodoBillingProvider` accepts an optional `brandId` (ADR 0009). When products share one Dodo business, Dodo sends every event to every webhook endpoint. With `brandId` set, a verified webhook whose `brand_id` names another brand is stored as `ignored` instead of being processed and quarantined. Webhooks without a `brand_id` are processed as before.
  
  **Product changes for this release**
  
  - Create the product's Dodo products under its own Dodo brand.
  - Pass that brand's ID as `brandId`, for example from a `DODO_BRAND_ID` environment variable.
- 7b4a9ad: Add a Lemon Squeezy provider adapter and subscription adoption (ADR 0014).
  
  - `@codelitdev/billing/providers/lemonsqueezy` exports `createLemonSqueezyBillingProvider({ apiKey, storeId, webhookSecrets })`. Catalog offers use Lemon Squeezy variant IDs. Webhooks from other stores are stored as `ignored`. A checkout offers only the chosen variant, so the buyer cannot switch plans on the Lemon Squeezy page.
  - `adoptProviderSubscription` (engine and `createOperations`) takes over a subscription created outside the engine, such as one started with the provider before the product used this package. The subscription's product must be in the active catalog revision.
  - `commercialState` reports the `provider` holding the paid subscription.
  - `resumeCancellation` accepts a subscription whose status is `cancelled` while its cancellation is only scheduled, which is how Lemon Squeezy reports it until the period ends.
  - Providers can declare `checkoutAssignsCustomer`. For those, the first subscription from a payer's checkout moves the payer's customer record to the customer the provider chose. Lemon Squeezy declares it, because its checkout can create a new customer.
  - Providers can declare `intervalChangesBillImmediately`. For those, `startPlanChange` with `do_not_bill` to another billing interval fails with `plan_change_not_supported` before the provider is called. Lemon Squeezy declares it, because such a change restarts and bills the period.
  - Providers can declare `immediatePlanChangesOnly`. For those, `startPlanChange` with `effectiveAt: "next_billing_date"` fails with `plan_change_not_supported` before an attempt is created. Lemon Squeezy declares it.
  - Plan changes back to an offer used before on the same subscription no longer fail with a database unique-key error. Each attempt now has its own idempotency key.
  - Requesting a catalog revision number that another provider already uses now fails with `catalog_revision_used_by_another_provider` instead of a database unique-key error.
  
  **Product changes for this release**
  
  - To switch to Lemon Squeezy, compose its adapter, set `checkoutProvider: "lemonsqueezy"`, use variant IDs in the catalog, and mount its webhook at `/webhooks/billing/lemonsqueezy`.
  - Turn off plan changes in the Lemon Squeezy store's customer portal settings. The engine quarantines a plan change it did not start.
  - Adopt existing provider subscriptions once with `adoptProviderSubscription` after the catalog is verified.
  - Code that builds `CommercialBillingState` objects, such as test fixtures, must add `provider`.
- 7b4a9ad: A payer can switch offers while a checkout is open.
  
  - `startCheckout` for another offer, such as yearly after monthly, now replaces the payer's own open checkout instead of failing with `checkout_pending` until it expires. The old checkout becomes `abandoned`. If it is paid anyway, it becomes `conflicted`; it grants access when nothing else does, and otherwise the second subscription is quarantined. Another payer's open checkout still returns `checkout_pending`.
  - An expired checkout for another offer or payer is no longer reopened for the new request.
  - `CreateCheckoutInput` gains an optional `expiresAt`. The Lemon Squeezy adapter sends it as the checkout's `expires_at`, so the old page stops working when the attempt expires. Dodo checkout sessions take no expiry.
  
  **Product changes for this release**
  
  - None required. A product that showed a message for `checkout_pending` when a person switched intervals can keep it for the other-payer case.

### Patch Changes

- 7b4a9ad: `FakeBillingProvider` takes an optional `provider` name, so tests can compose two providers. A new test covers serving subscriptions on one provider after checkout moves to another.

## 0.3.0

No changes in this release.

## 0.2.0

### Patch Changes

- 9bef99a: Ship the `codelit-billing` CLI through a committed `bin/codelit-billing.js` shim so workspace installs link the command before `dist/` is built.

## 0.1.0

### Patch Changes

- Publish the existing Billing package as a stable release.
