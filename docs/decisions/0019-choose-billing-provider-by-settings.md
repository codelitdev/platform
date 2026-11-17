# ADR 0019: Choose the billing provider by settings

Status: accepted  
Date: 2026-11-17

## Context

The provider contract lets a product swap adapters, but each product parsed its
own env and called one adapter's constructor. Moving CourseLit from Dodo to
Lemon Squeezy, and back when Lemon Squeezy announced it is winding down, needed
code changes each time. MediaLit had already written env parsing that picks the
provider and keeps the old one connected for its subscribers.

## Decision

- Add `@codelitdev/billing/providers/env`, based on MediaLit's parsing:
  `readBillingProviderEnv`, `createBillingProvidersFromEnv`,
  `dodoOptionsFromEnv` and `lemonSqueezyOptionsFromEnv`.
- The functions take the env record as an argument. Core and adapters still
  never read the process environment (invariant 2).
- Settings names are shared by every product: `BILLING_PROVIDER`,
  `BILLING_CATALOG_REVISION`, `BILLING_CURRENCY`,
  `BILLING_DATA_ENCRYPTION_KEY`, `BILLING_<OFFER>_AMOUNT_MINOR` and
  `BILLING_<OFFER>_PRODUCT_ID`, plus each provider's credentials.
- New checkout goes to `BILLING_PROVIDER`. Any other provider whose
  credentials are set stays connected, so its subscriptions keep receiving
  webhooks and reconciliation.
- Offers always have `providerTrialDays: 0`. Trials are the product's own.
- Adapters are loaded with dynamic imports, so the optional `dodopayments` peer
  is needed only by products that use Dodo.

## Consequences

- A product switches provider by changing settings and raising
  `BILLING_CATALOG_REVISION`.
- Products should accept every connected provider on
  `POST /webhooks/billing/:provider`.
- `createBillingProvidersFromEnv` is async, so engine composition that uses it
  must be too.
