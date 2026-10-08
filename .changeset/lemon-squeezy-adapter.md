---
"@codelitdev/billing": minor
---

Add a Lemon Squeezy provider adapter and subscription adoption (ADR 0014).

- `@codelitdev/billing/providers/lemonsqueezy` exports `createLemonSqueezyBillingProvider({ apiKey, storeId, webhookSecrets })`. Catalog offers use Lemon Squeezy variant IDs. Webhooks from other stores are stored as `ignored`. A checkout offers only the chosen variant, so the buyer cannot switch plans on the Lemon Squeezy page.
- `adoptProviderSubscription` (engine and `createOperations`) takes over a subscription created outside the engine, such as one started with the provider before the product used this package.
- `commercialState` reports the `provider` holding the paid subscription.
- `resumeCancellation` accepts a subscription whose status is `cancelled` while its cancellation is only scheduled, which is how Lemon Squeezy reports it until the period ends.
- Providers can declare `checkoutAssignsCustomer`. For those, the first subscription from a payer's checkout moves the payer's customer record to the customer the provider chose. Lemon Squeezy declares it, because its checkout can create a new customer.
- Providers can declare `intervalChangesBillImmediately`. For those, `startPlanChange` with `do_not_bill` to another billing interval fails with `plan_change_not_supported` before the provider is called. Lemon Squeezy declares it, because such a change restarts and bills the period.
- Plan changes back to an offer used before on the same subscription no longer fail with a database unique-key error. Each attempt now has its own idempotency key.
- Requesting a catalog revision number that another provider already uses now fails with `catalog_revision_used_by_another_provider` instead of a database unique-key error.

**Product changes for this release**

- To switch to Lemon Squeezy, compose its adapter, set `checkoutProvider: "lemonsqueezy"`, use variant IDs in the catalog, and mount its webhook at `/webhooks/billing/lemonsqueezy`.
- Turn off plan changes in the Lemon Squeezy store's customer portal settings. The engine quarantines a plan change it did not start.
- Adopt existing provider subscriptions once with `adoptProviderSubscription` after the catalog is verified.
- Code that builds `CommercialBillingState` objects, such as test fixtures, must add `provider`.
