---
"@codelitdev/platform": minor
---

Add `@codelitdev/platform/billing` and `@codelitdev/platform/billing/drizzle` with the adapters products wrote themselves around `@codelitdev/billing` (ADR 0013): single-use action grants stored in Better Auth's `verification` table, AES-256-GCM encryption for stored billing values, a return-URL validator, a maintenance worker runner, a webhook handler for `POST /webhooks/billing/<provider>` (400 for a rejected signature or body, 503 when a verified webhook cannot be stored, so the provider retries), and HTTP mapping for billing errors. `@codelitdev/billing` and `drizzle-orm` are optional peer dependencies; the root export is unchanged.

**Product changes for this release**

- Replace a custom `BillingAuthorizationPort` with `createBillingActionGrants`. Issue a token from an authenticated route, send it with the billing request, and handle `recent_authentication_required`.
- Replace custom encryption, return-URL checks, maintenance timers, webhook handlers, and billing error mapping with the matching adapters. Existing encrypted values stay readable.
