---
"@codelitdev/billing": minor
---

Choose the payment provider and catalog from env settings, so a product switches between Dodo and Lemon Squeezy without code changes.

- `@codelitdev/billing/providers/env`: `readBillingProviderEnv(env, { offers })` reads `BILLING_PROVIDER`, the catalog revision, currency and each offer's amount and product ID, and checks each provider's credentials. It returns null when `BILLING_PROVIDER` is unset, and names the setting when one is missing or invalid.
- A provider other than the checkout one stays connected while its credentials are set, so its subscribers keep working after a switch.
- `createBillingProvidersFromEnv(providers, env, clock)` loads each adapter only when used. `dodoOptionsFromEnv` and `lemonSqueezyOptionsFromEnv` build the options alone.
