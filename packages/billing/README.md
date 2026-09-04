# @codelitdev/billing

Provider-neutral billing engine for CodeLit products. It runs **inside** your API process against **your** PostgreSQL database. It is not a hosted billing service.

Version **0.1.0-alpha.3**. Workflows, action grants, operator services, and lifecycle hooks are **experimental**. There is no v1 cutover until a second consumer (CourseLit) proves the same contracts.

## Purpose

CodeLit products sell their own SaaS (organizations, schools, later other aggregates) through a payment provider. Without a shared engine, each product tends to grow its own catalog, checkout, webhooks, and reconciliation — and those copies diverge on the parts that are easy to get wrong.

This package standardizes those mechanics:

- Immutable, versioned price catalogs verified against the provider
- Checkout, customer portal, cancellation, and plan change
- Webhook verification, durable inbox, retrieve-current-then-project
- Subscription transitions, material projection diffs, and reconciliation leases
- Provider-safe public catalog / commercial-state read models
- Fake + Dodo adapters behind one contract

Your product still owns:

- Who is billed (organization, school, …)
- Plan names, entitlements, quotas, trials, grace, availability
- Whether a plan change is immediate or at renewal, and how it is prorated
- Auth, CSRF, recent-auth tokens, HTTP routes, UI
- Schema migrations, backfills, encryption keys, audit storage, alerts

The package never runs DDL on install, import, or process startup.

## Consumer guidelines

The engine is mechanical. It will not infer product policy from plan names.

**You decide, then pass in:**

| Decision             | How you tell the engine                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| Paid offers          | `offers` + `requiredOfferKeys` at `createBilling`; exact set, no `"free"` in `planIds`                   |
| Trial eligibility    | `trialDays` on checkout (0 if ineligible). Claims, HMAC, school trials stay in your tables               |
| Upgrade vs downgrade | `startPlanChange({ effectiveAt, prorationMode })`. The package does not rank Pro/Business                |
| What a plan unlocks  | Your entitlements resolver. `commercialState()` is paid snapshot only                                    |
| Entity lifecycle     | `getBillableEntityBillingBlockers` / `getPayerBillingResponsibilities`; you choose the user-facing error |
| Product side effects | `afterProjection` on the **engine transaction** (`store.getTransaction() ?? db`)                         |

**Plan-change flags the engine understands:**

- `effectiveAt`: `immediately` \| `next_billing_date`
- `prorationMode`: `prorated_immediately` \| `do_not_bill`

A typical SaaS split (what SendLit does, not required): upgrades → immediate + prorate; downgrades → next invoice + do not bill. Until a webhook/reconciliation snapshot actually shows the new product, `commercialState().activePaidPlan` stays on the current plan and `pendingPlanChange` is set. Your UI should disable a second change and say “being confirmed” vs “scheduled,” not pretend the plan already flipped.

**Do not:**

- Put application Free/OSS/trial into generated `planIds`
- Hold an app `db.transaction()` across a provider call, or nest `db.transaction()` on the root pool inside `afterProjection`
- Treat checkout redirect, `payment.succeeded`, or a toast as entitlement
- Re-interpret provider SDK errors in routes; map `BillingWorkflowError.code` only

## Install

```bash
bun add @codelitdev/billing@0.1.0-alpha.3
# or: bun add @codelitdev/billing@alpha
# Dodo is an optional peer of the Dodo adapter
bun add dodopayments
```

Public imports (do not import `src/`):

| Subpath                              | Use                                  |
| ------------------------------------ | ------------------------------------ |
| `@codelitdev/billing/config`         | `defineBillingConfig`                |
| `@codelitdev/billing/drizzle`        | `createDrizzleBillingStore`          |
| `@codelitdev/billing/workflows`      | `createBilling` (experimental)       |
| `@codelitdev/billing/operations`     | Operator inspect / retry / cancel    |
| `@codelitdev/billing/providers`      | Registry, fake, contract types       |
| `@codelitdev/billing/providers/dodo` | `createDodoBillingProvider`          |
| `@codelitdev/billing/core`           | Statuses, money, errors, clock       |
| `@codelitdev/billing/catalog`        | Offer validation / public catalog    |
| `@codelitdev/billing/testing`        | Provider contract + workflow harness |

CLI:

```bash
bun x codelit-billing generate --config billing.config.ts
bun x codelit-billing generate --check --config billing.config.ts
```

## How it fits together

```
Your API / UI
  auth, grants, plan policy, entitlements
       │
       ▼
  createBilling  ──► catalog + state machines
                 ──► provider adapter (Dodo / fake)
                 ──► Drizzle store ──► your Postgres
                 ──► your audit + afterProjection hooks
```

Hexagonal rules that matter in practice:

- Core never reads `process.env` or wall time. You inject a `Clock` and provider options.
- No database transaction is held across a provider HTTP call. Durable checkout / webhook / job rows bridge that gap.
- A verified webhook is a wake-up. Entitlement changes only after `retrieveSubscription` and a material snapshot diff.
- Cloud composition requires an audit hook and a return-URL allowlist.

## 1. Describe schema (`billing.config.ts`)

Same idea as Better Auth: the package owns the canonical model; you check in generated TypeScript and own SQL via drizzle-kit.

```ts
import { defineBillingConfig } from "@codelitdev/billing/config";

export default defineBillingConfig({
    dialect: "postgresql",
    adapter: "drizzle",
    output: "./src/db/schema/billing.generated.ts",
    billableEntity: {
        modelName: "organization",
        tableImport: "./organizations",
        tableExport: "organizations",
        idColumn: "id",
        idType: "uuid",
        onDelete: "restrict",
    },
    payer: {
        modelName: "user",
        tableImport: "./auth",
        tableExport: "user",
        idColumn: "id",
        idType: "text",
        onDelete: "restrict",
    },
    planIds: ["pro", "business"],
    requiredOfferKeys: [
        "pro_month",
        "pro_year",
        "business_month",
        "business_year",
    ],
    additionalFields: {
        checkoutAttempts: {
            pendingTeamName: { type: "text", nullable: true },
        },
    },
});
```

`planIds` are **paid** plans persisted on canonical rows. A product Free plan or cardless trial stays in your tables — do not put `"free"` here.

Then:

```bash
bun x codelit-billing generate --config apps/api/billing.config.ts
bun x drizzle-kit generate
bun x drizzle-kit migrate
```

CI should run `generate --check` so committed `billing.generated.ts` cannot drift. Hand-edit SQL for backfills (for example seeding a Free `billing_plan_states` row); never edit the generated TypeScript.

Examples: `examples/reference-product/`, `examples/consumers/sendlit/`.

## 2. Compose the engine

Parse your own env. Pass typed Dodo options. Wire Drizzle, grants, encryption, and product effects.

```ts
import { systemClock } from "@codelitdev/billing/core";
import { createDrizzleBillingStore } from "@codelitdev/billing/drizzle";
import { createBilling } from "@codelitdev/billing/workflows";
import { createDodoBillingProvider } from "@codelitdev/billing/providers/dodo";
import { db } from "./db/client";
import * as billingSchema from "./db/billing.generated";

const clock = systemClock;
const store = createDrizzleBillingStore(db, {
    schema: billingSchema,
    clock,
    planStateDefaults: { plan: "free", rampStage: 0, rampCleanStageDays: 0 },
    checkoutApplicationFields: {
        toColumns: (fields) => ({
            pendingTeamName:
                typeof fields.pendingTeamName === "string"
                    ? fields.pendingTeamName
                    : null,
        }),
        fromRow: (row) => ({ pendingTeamName: row.pendingTeamName ?? null }),
    },
});

export const billing = createBilling({
    database: store,
    providers: [
        createDodoBillingProvider({
            apiKey: process.env.DODO_PAYMENTS_API_KEY!,
            environment: "test_mode", // or "live_mode"
            webhookSecrets: [
                {
                    version: "current",
                    secret: process.env.DODO_PAYMENTS_WEBHOOK_KEY_CURRENT!,
                },
            ],
            clock,
        }),
    ],
    clock,
    authorization: yourGrantPort, // consume-once BillingAuthorizationPort
    sensitiveValues: yourEncryptPort,
    hooks: {
        audit: yourAuditHook,
        lifecycle: {
            afterProjection: (input) =>
                applyProductEffects(input, store.getTransaction() ?? db),
        },
    },
    mode: "cloud", // "oss" forbids providers, offers, and catalog revision
    checkoutProvider: "dodo",
    requestedRevision: 1,
    requiredOfferKeys: [
        "pro_month",
        "pro_year",
        "business_month",
        "business_year",
    ],
    offers: yourOffers, // must match requiredOfferKeys exactly
    returnUrlValidator: (url) =>
        new URL(url).origin === new URL(process.env.WEB_CLIENT!).origin,
});
```

`afterProjection` runs **inside** the engine transaction. Use `store.getTransaction() ?? db` and do **not** open a nested `db.transaction()` on the root pool client — that deadlocks on `FOR UPDATE` rows. If you were passed the engine client, write on it; only nest when you received the root `db`.

OSS mode: `mode: "oss"`, empty providers, `checkoutProvider: ""`, `requestedRevision: null`, no offers. The engine rejects checkout; your product unlocks paid capabilities itself.

## 3. Catalog at startup

Cloud startup validates config shape and **records** the requested revision. It must not block ordinary API readiness on Dodo.

```ts
await billing.recordRequestedCatalog();
// later, from a worker / sweep — not on the hot health path
await billing.verifyRequestedCatalog();
```

Checkout is available only when that requested revision is the verified **active** revision. A pending or invalid request sets `checkoutAvailable: false` on the public catalog; the last verified revision remains the commercial projection. Operators abandon a bad request with `abandonRequestedCatalog` after reverting config.

Immediately before creating a provider session, checkout re-fetches the selected product. A mismatch freezes new checkout; existing subscribers keep the last verified mapping.

## 4. Human billing actions

Your app authenticates the user, proves recent auth / CSRF however you like, then issues a **single-use** `BillingActionGrant`. The engine consumes the grant **and** checks the persisted payer. A fresh grant cannot switch the payer on an existing customer or subscription.

```ts
const { checkoutUrl } = await billing.startCheckout({
    grant,
    entity: { kind: "organization", id: organizationId },
    payer: { id: userId, email, name },
    offerKey: "pro_month",
    catalogRevision: displayedRevision, // the revision the UI showed
    returnUrl,
    trialDays: 14, // 0 if ineligible; the package does not decide eligibility
    applicationFields: { pendingTeamName: "Acme Team" },
});
```

Other grant actions: `startPortal`, `cancel`, and plan change:

```ts
await billing.startPlanChange({
    grant,
    entity: { kind: "organization", id: organizationId },
    payer: { id: userId, email, name },
    offerKey: "business_month",
    catalogRevision: displayedRevision,
    effectiveAt: "immediately", // or "next_billing_date"
    prorationMode: "prorated_immediately", // or "do_not_bill"
});
```

Submit the catalog revision the user saw; a stale revision fails with `catalog_changed` and may include the current public catalog.

Redirect is not payment. Entitlement changes from webhook projection or reconciliation. A scheduled plan change does not rewrite the subscription until the provider’s current snapshot matches the pending attempt.

## 5. Webhooks and workers

Preserve the **raw** body. Return 2xx after the event is durably inserted (duplicates included). Project asynchronously.

```ts
const ingested = await billing.ingestWebhook({
    provider: "dodo",
    raw: { body, headers },
});
res.status(ingested.duplicate ? 200 : 202).json({ accepted: true });
void billing.runWebhookInboxBatch({ workerId: `billing-${process.pid}` });
```

The package does not start timers. Your scheduler should call, with unique `workerId`s:

| Unit                          | Job                                                          |
| ----------------------------- | ------------------------------------------------------------ |
| `runWebhookInboxBatch`        | Drain verified events (retrieve + project)                   |
| `runReconciliationBatch`      | Stuck customers/checkouts/changes/subscriptions              |
| `runDeadlineBatch`            | Expire open checkouts; drop elapsed paid-through entitlement |
| `purgeExpiredSensitiveValues` | Drop old encrypted checkout URLs / replay payloads           |
| `verifyRequestedCatalog`      | Finish a pending catalog revision                            |

Multi-instance safety is database leases, not a process-local mutex. Never hold an app transaction across a provider call.

## 6. Read models

Ordinary routes must not call the provider.

```ts
const catalog = await billing.publicCatalog();
// { revision, checkoutAvailable, offers: [{ key, plan, interval, amountMinor, currency, displayTrialDays }] }
// no provider product IDs

const commercial = await billing.commercialState(organizationId);
// activePaidPlan, subscriptionStatus, periods, pendingCheckout / pendingPlanChange, projectionVersion
```

Compose those with your trial, Free plan, quotas, and `canManageBilling`. `projectionVersion` is a cache key; equivalent webhook replays update freshness only and do not increment it.

Before close / delete / owner demotion, call `getBillableEntityBillingBlockers` / `getPayerBillingResponsibilities` in the same transaction as the mutation. The package reports blockers; you decide the user-facing error.

Workflow failures are `BillingWorkflowError` with stable codes (`catalog_changed`, `payer_mismatch`, `checkout_pending`, …). Map them to HTTP in the app. Do not persist raw SDK messages.

## 7. Operator CLI

Product CLIs call `createOperations`. Every mutation needs `OperatorContext` (`actorId`, bounded `reason`, optional ticket) and hits the audit hook. The package does not ship an org/school CLI.

```ts
import { createOperations } from "@codelitdev/billing/operations";

const ops = createOperations({
    billing,
    clock,
    requestedRevision: 1,
    checkoutProvider: "dodo",
    sensitiveValues,
});

await ops.health();
await ops.inspectWebhook(providerEventId);
await ops.retryWebhook(ctx, providerEventId, "preserve_attempts"); // also drains the inbox
await ops.reconcileEntity(ctx, billableEntityId); // requires a local entitlement row
await ops.projectProviderSubscription(ctx, {
    providerSubscriptionId, // e.g. from the checkout return URL
    checkoutAttemptId, // optional; defaults to snapshot metadata
});
await ops.requestCancellation(ctx, subscriptionId);
const payload = await ops.inspectWebhookReplay(ctx, providerEventId);
```

`reconcileEntity` cannot invent a subscription from a paid-but-unprojected checkout. Use `projectProviderSubscription` when the provider already has a subscription id and local entitlement is still missing.

Do not `UPDATE billing_webhook_events SET status = 'pending'` by hand. Retry either preserves the attempt counter or starts `new_budget`.

Procedures: [`docs/runbooks.md`](docs/runbooks.md).

## 8. Tests

```ts
import {
    runBillingProviderContract,
    createWorkflowHarness,
} from "@codelitdev/billing/testing";
```

- `runBillingProviderContract(adapter)` — every adapter, including Dodo in CI against the fake and gated sandbox tests against Dodo test mode.
- `createWorkflowHarness()` — catalog, checkout, webhook ordering, grants, reconciliation without a network.

`bun test` is deterministic. Live Dodo sandbox tests stay behind an explicit env gate.

## What this package will not do

- Product routes, ts-rest, MCP, or UI
- Auth, membership, CSRF, or issuing action tokens
- Automatic SQL on install/import/startup
- A shared billing database
- Usage metering, tax, or invoices in this alpha
- Moving a live subscription from one provider to another
- SendLit reputation, domains, or “one owned Free org” policy

## Versioning

- **0.1.0-alpha.x** — experimental workflows. Public core/schema/provider types aim to stay stable; workflow/hook contracts can still change. Install with the `alpha` tag, not `latest`.
- Schema-changing package releases bump the generated schema version. Upgrade: bump the dependency → `generate` → review TS diff → `drizzle-kit generate` → add app backfills → migrate in the product job → deploy compatible API/worker.
- Architecture and rollout: [`docs/architecture.md`](docs/architecture.md). Extraction discrepancies: [`docs/decisions/0001-extraction-discrepancies.md`](docs/decisions/0001-extraction-discrepancies.md).

## Develop this repo

```bash
bun install
bun test
bun run typecheck
bun run build
bun run test:packed   # install the tarball via public exports only
```
