# ADR 0014: Lemon Squeezy adapter and subscription adoption

Status: accepted  
Date: 2026-10-08

## Context

The provider contract should let a product change payment providers by
swapping an adapter. Only Dodo and the fake provider existed. A product
moving to the package from Lemon Squeezy also has live Lemon Squeezy
subscriptions that were never created through an engine checkout. The
engine could not project them: it links a subscription to its owner through
the checkout attempt or an existing row, so such a subscription was
quarantined.

## Decision

- Add `@codelitdev/billing/providers/lemonsqueezy` with
  `createLemonSqueezyBillingProvider({ apiKey, storeId, webhookSecrets })`.
  It talks to the JSON:API over `fetch`, without a provider SDK.
- Mapping to the contract:
  - Catalog products are variant IDs; the currency is the store's.
  - Checkout sends the attempt ID and catalog key as `checkout_data.custom`,
    which webhooks return as `meta.custom_data`.
  - Cancel and resume set `cancelled: true` and `cancelled: false`. A
    cancelled subscription keeps paid access until `ends_at`, matching
    ADR 0010.
  - Statuses: `on_trial` is `trialing`; `paused` and `past_due` are
    `past_due`; `cancelled` is `cancelled` with `cancelAtPeriodEnd`;
    `unpaid` is `cancelled` with no paid period; `expired` is `expired`.
  - The portal is the customer's `urls.customer_portal`.
- Provider limits handled in the adapter:
  - No idempotency keys. Mutations use `lookup` recovery: customers are
    reused by email, and cancel and resume set absolute values.
  - Checkout cannot be tied to an existing customer, and Lemon Squeezy may
    create another one. The adapter declares `checkoutAssignsCustomer`, so
    the engine moves the payer's customer record to the customer named by
    the first subscription of that payer's checkout.
  - No webhook event ID or timestamp header. The event ID is a hash of the
    signed body, so a redelivery is a duplicate; the occurrence time is the
    resource's `updated_at`.
  - A checkout does not reference its subscription, so recovery of an
    unfinished checkout relies on webhooks and reconciliation.
  - Webhooks from another store are marked `foreign` (ADR 0009) and
    subscriptions from another store are rejected.
  - Trials are configured on the variant, so checkout rejects `trialDays`;
    variant changes apply immediately, so the adapter declares
    `immediatePlanChangesOnly` and the engine refuses scheduled plan changes
    before creating an attempt.
  - A variant on another interval restarts the billing period and bills it,
    even with prorations disabled. The adapter declares
    `intervalChangesBillImmediately`, and the engine refuses `do_not_bill`
    for such a change.
  - The customer portal can offer plan changes, but the engine only accepts
    changes it started. The adapter declares no portal plan changes, and the
    store must turn them off in its customer portal settings.
- Add the operator workflow `adoptProviderSubscription`, in the engine and in
  `createOperations`. Given a provider subscription ID, an entity, and a
  payer, it links the provider's customer to the payer, projects the
  subscription with that owner and the active catalog revision, and records
  an operator audit entry. The subscription's product must be in the active
  catalog. Adopting it again for the same entity is safe; another entity
  gets `operation_conflicted`.
- `commercialState` reports `provider`, so products can tell which provider
  holds a subscription without assuming one.

## Consequences

- A product switches provider by changing its adapter, catalog product IDs,
  and webhook route.
- A product adopts its existing subscriptions once, by script, after its
  catalog is verified.
- The Lemon Squeezy adapter is tested against recorded API shapes. It still
  needs a run against a Lemon Squeezy test store before production use.
