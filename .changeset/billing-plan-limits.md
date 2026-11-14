---
"@codelitdev/billing": minor
---

Add plan limits, end every paid status at its paid-through date, and check that Lemon Squeezy variants belong to the configured store.

- `planLimits` at `createBilling`, read with `getLimit()` and `limits()`. Every plan declares the same keys; `null` is unlimited; an undeclared key throws; `oss` mode is unlimited; a read error throws.
- `active`, `trialing` and `past_due` now stop granting their plan once `paidThroughAt` plus `entitlementGraceMs` (default seven days) has passed, so a lost provider webhook can't keep an entity entitled for good.
- Lemon Squeezy `paused` subscriptions no longer grant a plan (they map to `cancelled` and resume to `active`).
- Lemon Squeezy `retrieveProduct` rejects a variant from another store on the same account (`provider_product_wrong_store`). Checkout would otherwise sell in that store and its webhooks would be ignored.
