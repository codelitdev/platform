# ADR 0013: Platform billing adapters

Status: accepted  
Date: 2026-10-07

## Context

Architecture §10 says Platform supplies reusable adapters for billing action
grants, encryption, return-URL validation, worker startup, and scheduled
maintenance batches. None existed, so each product wrote its own. One
product bypassed single-use grants entirely by accepting any grant with a
known prefix. The template wired the in-memory grant store and the fake
provider, so new products started from a test setup.

The billing package itself excludes HTTP routes, issuing action tokens, and
encryption keys. These adapters belong next to it, not inside it.

## Decision

- `@codelitdev/platform` gains a `billing` export with
  `createBillingActionGrants`, `createAesGcmSensitiveValues` and
  `aesGcmSensitiveValuesFromEnv`, `createReturnUrlValidator`,
  `startBillingWorkers`, `handleBillingWebhook` and `billingWebhookPath`,
  and `billingErrorResponse`, plus a `billing/drizzle` export with
  `drizzleVerificationGrantStore`.
- `@codelitdev/billing` and `drizzle-orm` are optional peer dependencies.
  The root export stays dependency-free.
- Grants follow the existing database-backed design: a random token,
  stored only as a SHA-256 hash in Better Auth's `verification` table,
  bound to one person, session, action, and target, valid for five minutes,
  consumed atomically once, and issued only to a session that signed in
  within 15 minutes. Both limits are options.
- Encryption keeps the `iv.tag.ciphertext` format products already store, so
  existing values stay readable, and tries previous keys during rotation.
- The worker runner skips a tick while the previous one runs and reports
  failures per task. It is billing-specific; a product-neutral scheduler
  stays deferred (architecture §15).
- Error mapping exposes only workflow codes: 403 for grant and payer
  errors, 503 for an unavailable provider or catalog and for configuration
  errors, 409 for other workflow errors, and 502 for anything else.

## Consequences

- Products delete their own grant, encryption, return-URL, worker, webhook,
  and error-mapping code, and adopt these adapters.
- Billing actions need a recent sign-in. Products must handle
  `recent_authentication_required` by asking the person to sign in again.
- The `exports` test of `@codelitdev/platform` now lists the two billing
  exports.
