# Operational runbooks

Status: package-owned procedures for `@codelitdev/billing`  
Audience: SendLit and CourseLit operators composing product-authenticated commands over `createOperations` and maintenance units  
Package version: 0.1.0-alpha.3 (experimental workflows; not a v1 cutover)

These runbooks name package units, not HTTP routes. Product CLIs and admin screens must supply `OperatorContext`, persist audit rows, and keep product nouns (organisation, school, trial, availability) outside canonical billing tables.

Production canaries remain consumer-owned. Do not declare a v1/stable cutover until SendLit and CourseLit have each run a limited production canary.

## Shared controls

Bounded work units (the package does not start timers):

- `recordRequestedCatalog` / `verifyRequestedCatalog` / `abandonRequestedCatalog`
- `runWebhookInboxBatch`
- `runReconciliationBatch` / `claimReconciliationJobs`
- `runDeadlineBatch`
- `purgeExpiredSensitiveValues`
- operations: `inspectEntity`, `health`, `inspectWebhook`, `inspectWebhookReplay`, `retryWebhook`, `reconcileEntity`, `reconcileSubscription`, `projectProviderSubscription`, `requestCancellation`, `decryptReplay`

Multi-instance safety comes from database claims. Never hold an application transaction across a provider call.

---

## Webhook outage and replay

1. Confirm `health().oldestInboxAgeMs`, `quarantinedWebhooks`, and provider status-page/outage.
2. Keep ingesting: signature verification and durable insert must still 2xx before projection.
3. Replay from the provider dashboard or stored ciphertext only through `decryptReplay` plus provider replay. Do not re-post unverified bodies.
4. Drain with `runWebhookInboxBatch`. Duplicate `providerEventId` values must no-op.
5. If events quarantine, inspect metadata (not raw SDK text) and either `retryWebhook(..., "preserve_attempts")` or start `new_budget` with an audit reason.
6. If payment succeeded at the provider but no local entitlement row exists, `reconcileEntity` will fail with `subscription_required`. Catch up with `projectProviderSubscription` using the provider subscription id (return URL or provider dashboard) and the open checkout attempt id.

## Catalog mismatch at startup

1. Configuration validation is synchronous. Ordinary readiness must not wait on Dodo.
2. `recordRequestedCatalog` writes `pending_verification` without contacting the provider.
3. `verifyRequestedCatalog` retrieves products, then atomically inserts/reuses price entries, attaches revision items, retires the prior revision, and activates the new one.
4. Pending or invalid requested revisions set `checkoutAvailable=false`. Last verified revision remains the commercial projection.
5. Provider outage during verify leaves the revision pending; it does not mark it invalid.
6. After reverting env, `abandonRequestedCatalog` with actor/reason restores checkout on the prior verified revision.
7. An older instance cannot activate a lower revision over a newer active catalog.

## Stuck checkout/change

1. `health().stuckCreatingCheckouts` and entity `pendingCheckout` / `pendingPlanChange`.
2. `runDeadlineBatch` expires open/creating checkouts past `expiresAt` and clears checkout URLs.
3. `runReconciliationBatch` resumes `creating` attempts with the original idempotency key and stored payer email.
4. Do not delete the attempt. Abandon only through an audited operator path once the provider session is known terminal.

## Remote success with failed local persistence

1. Symptom: provider customer/session exists, local attempt stays `creating`, reconciliation job queued.
2. `runReconciliationBatch` must reuse the stored idempotency key and must not open a second provider customer/session identity.
3. After success, attempt is `open` (checkout) or the subscription projection is material once. Equivalent snapshot refresh must not increment `projectionVersion`.

## Duplicate provider customer

1. Unique constraint is `(provider, payerId)` plus a partial unique on provider customer id.
2. A second create for the same payer must return the stored row.
3. If the provider created two remote customers, keep the locally recorded `providerCustomerId`. Quarantine conflicting jobs; do not merge by email.

## Conflicting active subscriptions

1. At most one `isEntitlementSource` subscription per billable entity.
2. A second paid snapshot for the same entity quarantines rather than flipping the pointer.
3. Immediate cancellation plus projection must clear `activeSubscriptionId`.
4. Manual repair uses `reconcileSubscription` and audited projection, never a direct SQL pointer edit.

## Manual reconciliation with immutable correction/audit

1. `reconcileSubscription(context, subscriptionId)` requires actor/reason and writes an operator audit effect before work.
2. Reconciliation retrieves current provider truth and applies the same transitions as webhooks.
3. Corrections are new audited effects. Do not rewrite previous projection rows in place to hide history.

## Reconciliation lease exhaustion, reclaim, and quarantine

1. Claims use committed leases (`claimReconciliationJobs`). `FOR UPDATE SKIP LOCKED` must not span the provider call.
2. A crashed worker’s lease expires; another worker reclaims the same job.
3. Exhausted attempts or `operation_quarantined` / misconfigured provider errors move the job to `quarantined`.
4. Operator retry must say `preserve_attempts` or `new_budget`. Setting `status=pending` in SQL is not a public API.

## Entity close or payer removal blocked by live billing responsibility

1. Before product close/delete, call `getBillableEntityBillingBlockers` and `getPayerBillingResponsibilities`.
2. Live checkout, nonterminal subscription, or future paid-through entitlement must block close.
3. Do not cancel at the provider as a side effect of entity delete. Cancel through the cancellation workflow or operator cancel, then wait for terminal projection and elapsed paid-through (`runDeadlineBatch`).

## Sensitive action-token outage/replay and persisted payer mismatch

1. Checkout, portal, plan change, and cancellation consume a single-use grant before mutation.
2. A replayed grant returns `grant_consumed`.
3. A fresh grant cannot substitute a different payer than the one persisted on the customer/attempt/subscription (`payer_mismatch` / `grant_invalid`).
4. Token-issuer outage is an application/Platform incident. Billing must fail closed, not skip `consume`.

## Operator retry-budget reset versus preservation

1. `retryWebhook(context, providerEventId, "preserve_attempts")` requeues without clearing `processingAttempts`.
2. `"new_budget"` zeroes attempts and is a distinct audit effect.
3. Never expose retry as an unauthenticated script.

## Audited replay-payload inspection and retention purge

1. `decryptReplay` requires `OperatorContext` and a `SensitiveValuePort`. The decrypt is audited even when no row changes.
2. Applications choose retention. `purgeExpiredSensitiveValues({ before, limit })` nulls terminal checkout URLs, plan-change payment URLs, and processed/ignored webhook payloads older than `before`.
3. `before` must not be in the future. Purge is idempotent and writes one audit effect per cleared secret.
4. Immutable catalog, attempt, and projection history remains.

## Provider credential rotation

1. Inject API keys and webhook secrets from the application. The Dodo adapter never reads `process.env`.
2. Webhook secrets are a versioned list. Ingest tries unexpired versions; envelopes record `verifiedKeyVersion`.
3. Rotate by adding a new version, deploying, then expiring the old secret. Do not change checkout provider in the same change.
4. After rotation, run a sandbox retrieve (`BILLING_DODO_SANDBOX_*`) and a webhook ingest canary.

## Package rollback with app-owned migrations

1. The package never runs DDL on import, install, or worker start.
2. Roll back application code only to a build compatible with the already-applied Drizzle migration.
3. Do not reverse a billing migration that has expanded columns unless a reviewed down-migration exists in the product repo.
4. Catalog revisions and price entries are immutable; rollback of application config may `abandonRequestedCatalog` but must not delete historical mappings needed by live subscriptions.

## CourseLit trial/subscription expiry and public-availability verification

1. CourseLit 14-day trials are application state. They must not create a fake provider subscription or a Free plan row.
2. Canonical `runDeadlineBatch` clears entitlement when a cancelled subscription’s `paidThroughAt` has elapsed. Public school availability is CourseLit policy composed with `commercialState`.
3. Two schools under one payer expire independently. Recovering one school must not re-open the other.
4. Verify: unpaid school past trial is unavailable; paid school remains available; admin billing routes still load `commercialState`.

## Canary checklist (consumer-owned)

Until both products complete this list, keep `@codelitdev/billing@0.1.0-alpha.3` and treat workflows as experimental:

- Feature-flag or percentage canary in SendLit first.
- `generate --check` clean; reviewed Drizzle migration applied by the product job.
- Catalog record/verify against Dodo test then live products.
- One checkout, webhook, reconciliation reclaim, cancellation, and deadline/purge cycle.
- Action-grant consume-once and payer-mismatch probes.
- Operator audit visible for reconcile, retry, abandon, and decrypt.
- CourseLit canary only after SendLit’s limited production canary is green.
