---
"@codelitdev/billing": minor
---

`createDodoBillingProvider` accepts an optional `brandId` (ADR 0009). When products share one Dodo business, Dodo sends every event to every webhook endpoint. With `brandId` set, a verified webhook whose `brand_id` names another brand is stored as `ignored` instead of being processed and quarantined. Webhooks without a `brand_id` are processed as before.

**Product changes for this release**

- Create the product's Dodo products under its own Dodo brand.
- Pass that brand's ID as `brandId`, for example from a `DODO_BRAND_ID` environment variable.
