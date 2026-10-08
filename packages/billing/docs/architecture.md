# CodeLit Billing architecture

Status: proposed  
Audience: SendLit, CourseLit, FrontLit, MediaLit, and billing maintainers  
Package: @codelitdev/billing  
Package manager and runtime: Bun

## 1. Purpose

@codelitdev/billing is a provider-neutral engine for billing a CodeLit product's own SaaS customers. It extracts stable mechanics already proven in SendLit so CourseLit, FrontLit, MediaLit, and future products do not create divergent billing engines.

It standardizes difficult, security-sensitive mechanics:

- Provider adapters and canonical provider events.
- Immutable, versioned price catalogs.
- Checkout, portal, cancellation, and plan-change workflows.
- Subscription transitions and provider reconciliation.
- Webhook verification, deduplication, replay, and recovery.
- Deterministic clock and idempotency behavior.
- Provider-safe public read models and stable workflow outcomes.
- Multi-instance maintenance claims, lifecycle blockers, and operator recovery.
- Fake providers and reusable contract suites.

Each product still defines whom it bills, which plans it sells, what those plans unlock, and what expiry does.

### Source baseline

This architecture is grounded in two concrete SendLit sources:

- apps/api/docs/pricing-plans-and-payments-integration.md, the implementation PRD dated 2026-08-28.
- The current SendLit branch implementing that PRD under apps/api/src/billing and apps/api/src/db/schema.ts.

The extraction unit is a behavior with tests, not a SendLit directory or file. Several current files deliberately mix generic payment mechanics with organisation lifecycle, Free-plan policy, mail usage, reputation, notifications, Express security, and Drizzle transactions. Those files must be split at their dependency seams rather than moved wholesale.

## 2. Consumer policy matrix

The first two consumers intentionally differ:

| Concern            | SendLit                                            | CourseLit                                                   |
| ------------------ | -------------------------------------------------- | ----------------------------------------------------------- |
| Billable entity    | Organisation                                       | School                                                      |
| Cloud entry state  | Permanent Free plan                                | Cardless 14-day trial; no Free plan                         |
| Paid plans         | Pro and Business                                   | Pro and Business                                            |
| Intervals          | Monthly and yearly                                 | Monthly and yearly                                          |
| OSS                | All plan-controlled features unlocked; no provider | All plan-controlled features unlocked; no provider          |
| Trial              | SendLit-defined; may be provider-assisted          | CourseLit-managed per school, no fake provider subscription |
| Expiry consequence | SendLit entitlement policy                         | Public school unavailable; admin recovery remains           |
| Usage              | Contacts, sends, teams, reputation                 | CourseLit-defined capabilities/limits                       |
| Payer relationship | Product-defined                                    | One payer can pay for several independently billed schools  |

The shared package cannot contain a fixed plan union such as oss/free/pro/business. In particular, free must never leak into CourseLit's plan types, constraints, API, or UI.

FrontLit and MediaLit adopt only after SendLit and CourseLit prove the boundary.

## 3. Goals

1. Preserve SendLit's behavior during extraction.
2. Give CourseLit per-school billing without copying SendLit.
3. Test all providers against one public contract.
4. Make duplicate, delayed, missing, and out-of-order webhooks safe.
5. Keep plan and entitlement policy application-owned.
6. Release independently using SemVer and migration guides.
7. Work with or without the CodeLit Platform bootstrap.

## 4. Non-goals

The package does not provide:

- Product routes, ts-rest contracts, MCP tools, or UI.
- Authentication, membership, owner-role policy, CSRF, or recent-auth token issuance.
- Plan names, feature policy, quota dimensions, trial/grace duration, or availability.
- Product-specific schema extensions, entitlement-adjustment tables, migrations, backfills, retention, or deletion policy.
- Automatic DDL during package installation, import, API startup, or worker startup.
- A shared billing database or hosted billing service.
- Accounting, revenue recognition, or tax behavior beyond a provider contract.
- A universal usage-metering system in version 1.
- Automatic migration of a subscription between providers.
- SendLit's one-owned-Free-organisation rule or verified-email trial-abuse policy.
- SendLit's sending reputation, domain verification, marketing ramp, and notification policy.

Although actor eligibility is application-owned, package workflows still enforce billing identities already persisted in canonical state. For example, a portal or plan-change request cannot substitute a different payer merely because the application passed an authorized actor.

## 5. Architecture

    Consuming application
      API/UI -> authentication and authorization
             -> product plans/trials/entitlements
             -> @codelitdev/billing workflows
                    |-> catalog and transition core
                    |-> provider adapter -> Dodo / future provider
                    |-> generated canonical schema + Drizzle adapter
                    |                                  -> product PostgreSQL
                    |-> application audit/outbox
                    +-> injected no-op or product telemetry

The package uses hexagonal boundaries:

- Core code imports no provider SDK, Express, Drizzle, Pino, PostHog, or product module.
- Provider SDKs remain behind adapters.
- The package owns the canonical billing schema specification, generator, and optional Drizzle adapter.
- Applications own the checked-in generated schema, migration generation/review/execution, foreign-key targets, backfills, and product extensions.
- Product effects are application-supplied transactional hooks.
- Workflows coordinate local/remote state but do not own product policy.

## 6. Package layout and exports

Start as one package with explicit subpath exports. Split provider packages only if SDK weight or release cadence demonstrates a need.

    billing/
      src/
        core/
          ids.ts
          money.ts
          subscription.ts
          checkout-attempt.ts
          plan-change-attempt.ts
          webhook-inbox.ts
          transitions.ts
          errors.ts
          clock.ts
          projection-diff.ts
        catalog/
          types.ts
          validate.ts
          revisions.ts
          public-view.ts
        config/
          define.ts
          validate.ts
        schema/
          canonical.ts
          generator.ts
          drizzle.ts
        adapters/
          drizzle/
        workflows/             experimental until two-consumer proof
          customer.ts
          checkout.ts
          portal.ts
          plan-change.ts
          cancellation.ts
          webhook.ts
          reconciliation.ts
          lifecycle.ts
        maintenance/
          claims.ts
          batches.ts
          health.ts
        operations/
          inspect.ts
          reconcile.ts
          retry.ts
          catalog.ts
          cancellation.ts
        ports/
          authorization.ts
          audit.ts
          sensitive-values.ts
          lifecycle.ts
          telemetry.ts
        providers/
          contract.ts
          registry.ts
          dodo/
          fake/
        testing/
          provider-contract.ts
          workflow-harness.ts
          consumer-conformance.ts
          state-machine.ts
          clocks.ts
          fixtures.ts
        cli/
          generate.ts
          check.ts
      docs/
        architecture.md
        adoption.md
        provider-authoring.md
        decisions/

Public paths:

    @codelitdev/billing/core
    @codelitdev/billing/catalog
    @codelitdev/billing/config
    @codelitdev/billing/drizzle
    @codelitdev/billing/workflows
    @codelitdev/billing/operations
    @codelitdev/billing/providers
    @codelitdev/billing/providers/dodo
    @codelitdev/billing/testing

The package exposes schema-generation/check commands through its bin entry. Product operator CLIs and admin screens call the operations API; the package does not ship a product-authenticated universal operator CLI. Consumers cannot import src paths. CI tests a packed artifact using only exports.

## 7. Canonical domain

The model uses opaque application identifiers and generic string plan IDs:

    BillingInterval = month | year

    CanonicalSubscriptionStatus =
      pending | trialing | active | past_due | cancelled | expired

    BillableEntityRef = {
      kind: application-defined string
      id: opaque application ID
    }

    PayerRef = {
      id: opaque application ID
      email: provider input, never an analytics identity
      name: optional
    }

    BillingOffer<PlanId, OfferKey> = {
      key
      revision
      plan
      interval
      currency
      amountMinor
      provider
      providerProductId
      providerTrialDays
    }

Rules:

- Money is an integer minor-unit amount plus uppercase ISO 4217 currency.
- Provider IDs are bounded opaque strings.
- Product IDs are never inferred from provider IDs.
- PlanId and OfferKey come from the application.
- Application trials are entitlement sources, not plans.
- A cardless application trial does not require a provider subscription.
- cancelAtPeriodEnd is independent from canonical status.
- Provider period, paid-through, provider-trial, occurrence, and observation instants are explicit.
- Product grace and cardless-trial deadlines are supplied by the application and never inferred from provider timestamps.
- Decision functions receive an injected Clock; core code never reads wall time directly.

A normalized provider snapshot contains provider/customer/subscription/product IDs, canonical status, period dates, paid-through/trial dates, scheduled cancellation, provider occurrence/version information when available, observation time, and allowlisted string metadata. Provider-native status and SDK objects never escape the adapter.

Webhook evidence and subscription truth are separate types:

    VerifiedWebhookEnvelope = {
      provider
      providerEventId
      eventType
      occurredAt
      subscriptionId | null
      verifiedKeyVersion | null
      correlationMetadata
    }

    SubscriptionSnapshot = {
      provider
      providerCustomerId
      providerSubscriptionId
      providerProductId
      canonical status and periods
      providerOccurredAt | null
      providerVersion | null
      observedAt
      correlationMetadata
    }

The verified webhook envelope is a durable wake-up signal, not entitlement truth. For a subscription event, the worker calls retrieveSubscription and projects the current snapshot. This is the implemented SendLit behavior and prevents a delayed but valid webhook from rolling state backward.

Adapters may return a snapshot while parsing when a provider has already supplied and verified one, but the workflow must still support a configured retrieve-current-before-project policy. The initial Dodo policy always retrieves. Webhook occurrence, provider-state change, and local observation are distinct clocks. When the provider exposes no state version/change time, ordering uses the retrieved current snapshot plus material-state comparison; it must not pretend that retrieval time is provider event time.

## 8. Billable entity, payer, customer, and subscription

These are distinct:

- Billable entity: resource receiving entitlement, such as an organisation or school.
- Payer: authenticated account authorized by the application to manage billing.
- Provider customer: provider-side record for a payer and provider.
- Subscription: commercial agreement attached to one billable entity.

One provider customer may be reused by the same payer/provider. Every billable entity still has an independent subscription. A failed or cancelled CourseLit school cannot affect sibling schools.

The application authorizes the actor before calling billing. The package receives resolved references; it never queries memberships or assumes owner roles. Once a payer starts checkout, however, the package persists that association on the customer, attempt, and resulting subscription and enforces it for payer-sensitive workflows. A second owner does not become the provider customer merely by being an owner.

The package exposes lock-aware billing responsibility queries rather than owning product deletion:

    getBillableEntityBillingBlockers(entity, now) ->
      nonterminal_subscription |
      future_paid_entitlement |
      live_checkout |
      pending_plan_change

    getPayerBillingResponsibilities(payer, now) ->
      provider customers and subscriptions for which the payer remains responsible

The application calls these inside the same transaction and documented lock order as close, delete, owner demotion, or payer-account deletion. It decides the user-facing consequence. A normal entity DELETE never performs a surprise remote cancellation, and a payer/provider-customer transfer is never implemented by overwriting an identifier. Cancellation-and-recreate or an eventual explicit transfer workflow requires verified provider support and an audited product operation.

## 9. Provider contract

The initial interface follows SendLit's working adapter while removing SendLit metadata:

    BillingProviderAdapter {
      provider
      capabilities {
        planChanges
        intervalChanges
        portalPlanChanges
        portalIntervalChanges
        proratedPlanChanges
        intervalChangesBillImmediately?
        mutationRecovery {
          createCustomer: idempotency_key | lookup
          createCheckout: idempotency_key | lookup
          planChange: idempotency_key | lookup | unsupported
          cancellation: idempotency_key | lookup | unsupported
        }
      }

      createCustomer(input)
      createCheckout(input)
      createPortalSession(input)
      changeSubscriptionPlan(input)
      cancelSubscription(subscriptionId, idempotencyKey)
      retrieveProduct(productId)
      retrieveSubscription(subscriptionId)
      parseWebhook(rawBodyAndHeaders)
    }

Only adapters import provider SDKs or interpret provider payload/status names. Errors map to:

- invalid
- unauthorized
- conflict
- rate_limited
- unavailable
- misconfigured

Persisted attempts and logs store only stable categories. Raw SDK messages/bodies are never exposed or persisted as summaries.

Provider capabilities are authoritative. A workflow returns a typed unsupported-operation result when a provider cannot make a requested change. UI and API then choose portal, scheduled change, or rejection explicitly.

An idempotencyKey parameter alone is not proof that a provider honors it. Every mutation declares a tested recovery strategy. A provider whose create-subscription operation supports neither idempotency nor a deterministic lookup cannot be used by the checkout workflow. Contract tests inject an ambiguous timeout after the provider side effect and prove that retry returns the original remote object rather than creating another one.

Initial adapters:

- Dodo Payments, extracted from SendLit without behavior changes.
- Deterministic fake supporting success, delay, duplicate, out-of-order, bad-signature, and outage scenarios.

A new adapter must pass the exported provider contract suite.

Provider construction uses explicit typed options, not direct process.env reads:

    createDodoBillingProvider({
      apiKey,
      environment,
      webhookSecrets: [{ version, secret, expiresAt }],
      requestTimeoutMs,
      clock
    })

The consuming app parses and validates environment variables, chooses which adapters to instantiate, and limits secrets to API/worker processes that need them.

Provider calls have bounded deadlines. Read-only retrieval may retry with bounded exponential backoff and jitter. Customer, checkout, plan-change, and cancellation mutations retry only with the original provider idempotency key or a proven provider lookup; an ambiguous timeout never creates a fresh mutation.

The provider contract includes cancellation even though the original PRD interface excerpt omitted it, because the implemented SendLit adapter, fake, and contract suite already require it.

## 10. Catalog

Prices are deployment data; capabilities are product policy.

The catalog module validates application-provided offers and provider snapshots. It does not directly read SENDLIT or COURSELIT environment variables.

Invariants:

- Offer keys are unique within a revision.
- A revision contains exactly the application-declared required offer-key set; neither partial activation nor an undeclared extra offer is allowed.
- Provider product IDs are unique per provider/revision unless explicitly supported.
- Amount, currency, interval, and provider identity match provider truth.
- Published revisions and entries are immutable.
- Historical subscriptions retain the checkout revision.
- Cloud startup synchronously validates configuration shape and records the requested revision, but ordinary product readiness does not wait on provider availability.
- A fully verified database revision is required for new checkout.
- OSS may use an empty catalog and no provider.

The catalog module exports a provider-safe public projection containing revision, offer key, plan, interval, currency, amountMinor, and application-supplied trial display data. It never contains provider IDs. The app may expose and cache this projection, but every checkout/change command must submit the revision it displayed. A stale revision fails before customer/attempt/provider mutation and may return the current safe catalog so the user can explicitly review the new price.

Canonical generated persistence, following SendLit's implemented model:

- billing_price_entries
- billing_catalog_revisions
- billing_catalog_revision_items

CourseLit supplies exactly pro_month, pro_year, business_month, and business_year for Cloud. SendLit may use the same paid offer shape while also having a Free plan. Neither rule is hardcoded here.

Catalog activation follows the implemented SendLit rolling-deployment model:

1. Synchronously validate local amounts, currencies, provider IDs, uniqueness, and monotonically positive revision.
2. Idempotently record a higher requested revision as pending_verification.
3. Verify provider products asynchronously.
4. Atomically insert/reuse immutable price entries, attach all revision items, retire the prior revision, and activate the new revision.
5. Prevent an older application instance from rolling the active revision backward.
6. Keep all historical product mappings needed by attempts, subscriptions, webhooks, and reconciliation.

A pending or invalid requested revision disables new checkout but never takes down ordinary API traffic, changes current entitlement, or guesses a price. An operator can abandon the requested revision with an audit reason after reverting configuration, restoring checkout on the prior verified revision.

Immediately before creating a provider customer/session, checkout retrieves and re-verifies the selected product. A mismatch freezes checkout before any charge while existing subscribers continue from the local verified projection.

### 10.1 Provider coexistence and migration

Configuration distinguishes:

- checkoutProvider: used only for new checkout.
- enabledProviders: adapters/webhook/reconciliation retained for every nonterminal or retained historical subscription.

Customer, price, attempt, subscription, webhook, and reconciliation records always carry provider identity. Switching provider is staged:

1. Enable old and new adapters and webhook endpoints.
2. Retain old catalog reverse mappings.
3. Activate a new catalog whose checkout provider is the new adapter.
4. Route only new checkout to the new provider.
5. Continue reconciling old subscriptions through their recorded provider.
6. Disable the old adapter only after its final relevant subscription is terminal and retention/runbook requirements permit it.

A late old-provider event may update its historical subscription but cannot replace the current entitlement source without winning the application's explicit activation state machine.

## 11. Generated persistence model

The package follows the [Better Auth database pattern](https://better-auth.com/docs/concepts/database): it owns a canonical model specification and a CLI that generates the schema required by the selected application adapter. With Drizzle, the consuming application checks in the generated schema and uses drizzle-kit to create and apply migrations. The package never mutates the database merely because it was installed or imported.

This splits ownership precisely:

| Artifact                                                  | Owner                            |
| --------------------------------------------------------- | -------------------------------- |
| Canonical billing model and constraints                   | @codelitdev/billing              |
| Schema generator and Drizzle runtime adapter              | @codelitdev/billing              |
| Billing configuration and external model mapping          | Consuming application            |
| Checked-in generated Drizzle schema                       | Consuming application repository |
| Generated SQL migration, review, backfill, and deployment | Consuming application            |
| Product-specific tables and columns                       | Consuming application            |
| Canonical billing CRUD/state persistence                  | Billing Drizzle adapter          |
| Product audit, notifications, and lifecycle effects       | Application transactional hooks  |

### 11.1 Canonical generated schema

Version 1 generates these package-owned models:

- billing_price_entries
- billing_catalog_revisions
- billing_catalog_revision_items
- billing_provider_customers
- billing_checkout_attempts
- billing_plan_change_attempts
- billing_subscriptions
- billing_plan_states
- billing_webhook_events
- billing_reconciliation_jobs

The generated models include canonical columns, indexes, unique constraints, partial unique constraints, status checks, timestamps, and provider identities described in this architecture. In particular:

- Provider customers are unique by provider and payer.
- Provider subscriptions are unique by provider and provider subscription ID.
- At most one subscription per billable entity is the entitlement source.
- Checkout and plan-change idempotency keys are unique.
- Only one nonterminal checkout/change attempt exists per billable entity. A payer who starts checkout for another offer replaces their own open checkout, which becomes abandoned; another payer's open checkout returns checkout_pending.
- Webhook events are unique by provider and provider event ID.
- Catalog revisions and immutable provider price identities obey Section 10.
- Reconciliation jobs have exactly one canonical subject foreign key, one live job per subject, and reclaimable lease metadata.

The package uses generic billing_subscriptions and billing_plan_states names. It does not generate organisation- or school-named tables. The generated billableEntityId and payerId columns reference application-selected models.

The canonical meaning of billing_plan_states is deliberately narrow: billableEntityId, nullable activeSubscriptionId, and monotonically increasing projectionVersion. The active paid plan is read from the referenced subscription. A fallback Free plan, a cardless trial, overrides, ramp state, availability, and other effective-entitlement columns are application fields or separate tables. This avoids forcing a Free row value into CourseLit while allowing SendLit to map its existing plan column as an extension.

A subscription stores its exact commercial lineage, not merely the provider product currently attached to it:

- Provider customer and immutable payer/billing-manager reference.
- Origin checkout attempt when known.
- Current catalog revision, offer key, and immutable price entry.
- Provider subscription/product identity and canonical snapshot fields.
- Last provider version/change time when available, last observed time, and last reconciled time.

An unchanged price entry may appear in several revisions, so priceEntryId alone cannot recover the revision the customer accepted. Initial activation takes lineage from the checked attempt. A verified plan change moves the subscription to that attempt's target revision/offer/price in the same transaction that completes the attempt.

A provider-side product change with no correlated plan-change attempt cannot silently select the newest revision. It is quarantined unless the application explicitly supports provider-originated changes and supplies an audited deterministic mapping. Pre-extraction subscriptions receive lineage through an application backfill manifest rather than a max-revision guess.

billing_reconciliation_jobs provides durable claims for provider customers, checkout attempts, plan-change attempts, and subscriptions. It uses nullable foreign keys plus a check that exactly one subject is set, and stores provider, status, attempt count, availableAt, lockedAt, leaseExpiresAt, workerId, lastError, and timestamps. This is separate from the webhook inbox: webhook delivery is evidence, while reconciliation is scheduled recovery of canonical records.

The canonical specification does not define:

- Trial-claim policy tables.
- Product entitlement-adjustment or overage tables.
- Product usage, quota, reputation, or safety-control tables.
- Product audit/outbox/notification tables.
- Product lifecycle semantics.

Those remain application extensions because their semantics differ between consumers. Applications normally use separate tables. When an existing schema or atomic access pattern requires extra columns on a canonical model, configuration may declare additionalFields. The generator emits and types those fields, while package workflows treat them as opaque and never assign product meaning to them.

State-changing billing and operator workflows require an application audit hook; telemetry is not a substitute. The hook receives a stable effect ID, actor kind/reference, reason where required, previous and next canonical values, and safe correlation IDs inside the same database transaction. The application's audit table and product nouns remain application-owned, but an absent required hook is a composition error in Cloud mode.

### 11.2 Application configuration

The reference app defines one workspace as the billable entity and one account as the payer:

    // billing.config.ts
    import { defineBillingConfig } from "@codelitdev/billing/config";

    export default defineBillingConfig({
      dialect: "postgresql",
      adapter: "drizzle",
      output: "./src/db/schema/billing.generated.ts",

      billableEntity: {
        modelName: "workspace",
        tableImport: "./workspaces",
        tableExport: "workspaces",
        idColumn: "id",
        idType: "uuid",
        onDelete: "restrict"
      },

      payer: {
        modelName: "account",
        tableImport: "./auth",
        tableExport: "accounts",
        idColumn: "id",
        idType: "text",
        onDelete: "restrict"
      },

      planIds: ["pro", "business"]
    });

CourseLit maps billableEntity to schools. SendLit maps it to organizations. The generated schema therefore retains real database foreign keys without teaching the package either product noun.

Configuration controls table prefix/names, per-model table names, SQL dialect, external model imports, ID column types, deletion behavior, allowed persisted paid plan identifiers, and optional additionalFields. It cannot remove package-required columns or weaken uniqueness/state constraints.

This extension mechanism lets SendLit preserve fields such as teams/contact overrides, ramp state, and pending team name while mapping its existing organisation-named tables. Those fields remain SendLit policy despite appearing in generated source.

### 11.3 Generation and migration lifecycle

Initial reference-app setup:

    bunx @codelitdev/billing generate
    bunx drizzle-kit generate
    bunx drizzle-kit migrate

The first command loads billing.config.ts and writes billing.generated.ts. The file starts with a generated warning and package schema version. It is committed but never manually edited.

CI runs:

    bunx @codelitdev/billing generate --check

Check mode renders into memory and fails when the committed output differs. Package CI also generates a clean reference app, type-checks the schema, runs drizzle-kit generation, applies the migration to an empty database, and runs adapter conformance.

For a package upgrade:

1. Upgrade @codelitdev/billing.
2. Regenerate the Drizzle schema.
3. Review the generated source diff.
4. Generate and review the SQL migration.
5. Add any application-specific backfill.
6. Run package and product conformance tests.
7. Apply the migration through the product's deployment migration job.
8. Deploy compatible API/worker code.

The package never runs DDL from postinstall, module import, API startup, or worker startup. It does not silently invoke drizzle-kit. A package release that changes storage ships a schema changelog, compatibility range, expand/backfill/enforce guidance, and test fixtures. Code generation cannot decide how production data should be backfilled or deleted.

Direct billing migrate and programmatic migration commands are out of scope for the Drizzle adapter in version 1. The application remains the migration authority.

### 11.4 Runtime Drizzle adapter

The application passes the generated schema and Drizzle client into the package:

    import * as billingSchema from "./db/schema/billing.generated";

    const billing = createBilling({
      database: drizzleBillingAdapter(db, {
        schema: billingSchema
      }),
      providers,
      clock,
      telemetry,
      hooks,
      // Application-owned absolute HTTPS origin/path allowlist.
      returnUrlValidator: isAllowedBillingReturnUrl
    });

The adapter implements canonical repositories and transaction/locking behavior. Core/workflow modules remain ORM-neutral; only the drizzle subpath imports Drizzle.

The adapter may open short product-database transactions around canonical billing state. It never holds one open across provider network calls. Durable attempts bridge the local/remote boundary. Database uniqueness remains the final concurrency defense.

Every workflow that crosses the network follows prepare/call/finalize:

1. In a short transaction, lock in canonical order, revalidate, persist the operation/claim and stable idempotency key, then commit.
2. Call the provider with no application transaction open.
3. In a new short transaction, lock and revalidate the same rows, then finalize only if the operation still owns the claim and expected state.
4. If step 2 is ambiguous or step 3 fails, leave a durable nonterminal record for reconciliation with the original key.

The adapter computes a canonical snapshot diff before writing a projection. Provider status, product/price lineage, period boundaries, paid-through/trial values, cancellation flag, and active-subscription pointer are material fields. lastObservedAt and lastReconciledAt are operational freshness fields. Reprocessing an equivalent current snapshot may update freshness but must not increment projectionVersion, append another audit transition, or invoke a product effect twice. A material change increments projectionVersion exactly once in the same transaction as canonical state and the audit/outbox hooks.

Application hooks receive a constrained transaction-scoped context so product audit/outbox effects can commit atomically with a billing projection. Hook effects use the stable effect ID as a uniqueness key. Hooks cannot replace canonical rows or weaken billing invariants. Network notifications run from an application outbox after commit.

Sensitive checkout/portal URLs and replay payloads use configured application security services. Encryption keys, rotation, retention, purge, and audited operator decryption remain deployment policy even when the adapter stores the encrypted values.

### 11.5 Reference app and generated products

The platform reference app is the executable schema integration:

    examples/reference-product/
      apps/api/
        billing.config.ts
        src/
          billing/
            policy.ts
            hooks.ts
            routes.ts
            webhook-routes.ts
            worker.ts
          db/schema/
            auth.ts
            workspaces.ts
            billing.generated.ts
          db/migrations/

The platform template includes the configuration, generated schema, initial migration, runtime composition, and conformance test. Bootstrap copies these once. A generated product then owns its configuration, generated artifact, migrations, and product hooks; later changes arrive through package upgrades and explicit regeneration, not template merges.

Product extensions live in separate files and reference canonical billing rows when needed. For example, a SendLit entitlement-adjustment table remains SendLit code rather than modifying billing.generated.ts.

### 11.6 Application-owned trial persistence

Trial claims remain application persistence in version 1. SendLit's user-plus-verified-email HMAC claim prevents repeat Pro-month trials, while CourseLit's cardless trial belongs durably to a school and has different abuse/lifecycle rules. Billing offers may carry providerTrialDays as application input, but the package does not decide eligibility.

### 11.7 Shared state machines

Pure transition guards are package-owned and used by the generated persistence adapter.

Checkout attempt:

| From                    | Allowed next                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| creating                | open, expired, abandoned, conflicted                                                                  |
| open                    | completed, expired, abandoned, conflicted                                                             |
| expired                 | completed only with verified pre-expiry subscription and unchanged entity/payer; otherwise conflicted |
| abandoned               | conflicted on any late subscription                                                                   |
| completed or conflicted | none without audited operator repair                                                                  |

Plan-change attempt:

| From                             | Allowed next                           |
| -------------------------------- | -------------------------------------- |
| creating                         | pending, succeeded, failed, conflicted |
| pending                          | succeeded, failed, conflicted          |
| succeeded, failed, or conflicted | none without audited operator repair   |

Webhook inbox:

| State       | Meaning                                             |
| ----------- | --------------------------------------------------- |
| pending     | durably verified and waiting                        |
| processing  | leased by a worker                                  |
| failed      | retryable and waiting for availableAt               |
| processed   | applied or safely no-op                             |
| ignored     | verified but irrelevant by explicit policy          |
| quarantined | exhausted or inconsistent; operator action required |

Provider customer:

| State      | Meaning                                                      |
| ---------- | ------------------------------------------------------------ |
| creating   | durable placeholder exists; remote outcome may be ambiguous  |
| active     | provider customer identity attached                          |
| conflicted | identity mismatch or unrecoverable duplicate requires review |

Reconciliation job:

| State       | Meaning                                                          |
| ----------- | ---------------------------------------------------------------- |
| pending     | due or scheduled and claimable at availableAt                    |
| processing  | owned until leaseExpiresAt                                       |
| failed      | retryable under bounded backoff                                  |
| completed   | no current work; may be rescheduled idempotently                 |
| quarantined | inconsistent/exhausted and requires an audited operator decision |

The package exports transition decisions and reasons. The Drizzle adapter performs canonical row locks and enforces generated constraints. Application hooks add product audit events, entity lifecycle changes, and outbox notifications.

At most one subscription per billable entity may be the entitlement source. This is both a pure projection invariant and a generated partial unique database constraint.

## 12. Workflows

### 12.1 Startup catalog verification

1. The application parses deployment configuration and declares offers.
2. Package validates local invariants.
3. Application records a higher requested revision without blocking ordinary readiness.
4. Verification worker retrieves configured products.
5. Package compares amount, currency, interval, and identity.
6. Application transaction inserts or verifies immutable entries/revision and switches active revision atomically.
7. Checkout is available only when the configured requested revision is the verified active revision.

OSS mode is application policy. It supplies no provider/offers and should reject provider configuration at startup.

### 12.2 Customer resolution

1. Find customer by payer/provider.
2. If absent, persist an attempt/idempotency key.
3. Call createCustomer outside the transaction.
4. Upsert under a unique payer/provider constraint.
5. If remote success is followed by local failure, retry with the same key or reconcile; never create blindly.

### 12.3 Checkout

1. Application authenticates, requires recent auth where needed, and authorizes billing management.
2. Resolve an immutable active offer.
3. Reject incompatible active subscription/attempt state.
4. Persist checkout attempt and idempotency key.
5. Resolve provider customer.
6. Create provider checkout outside a DB transaction with attempt ID, entity reference, offer key/revision, safe URLs, and allowlisted metadata.
7. Persist provider session and redirect URL.
8. Recover local-finalization failure via durable attempt and provider idempotency.

A redirect is not proof of payment. Entitlement changes only from a verified provider snapshot/webhook or reconciliation.

### 12.4 Webhook

1. Product route preserves the exact raw body.
2. Adapter verifies signature/timestamp and returns a VerifiedWebhookEnvelope, including which key version verified it.
3. Persist provider event identity/receipt under a unique constraint before returning 2xx.
4. Duplicate processed events return success without mutation.
5. Worker retrieves the provider's current subscription snapshot; the event is only a wake-up signal.
6. Resolve entity from trusted stored association or checked high-entropy attempt metadata, never request host/input.
7. Validate provider, customer, subscription, product, price entry, payer, and attempt correlations.
8. Apply snapshot through transition guards in one product transaction.
9. Update the canonical subscription and authoritative pointer only for a material snapshot diff.
10. Write the required product audit/outbox effect transactionally under a stable effect ID.
11. Mark processed; retryable failures remain claimable.

An older event cannot regress a newer snapshot. Unknown products, unmatched subscriptions, abandoned-entity activation, and conflicting live subscription sources are quarantined rather than mapped to a default plan.

The durable inbox uses reclaimable leases and configurable bounded backoff. SendLit's current policy—five-minute leases, eight attempts, then quarantine—is the first fixture, not an immutable package constant.

### 12.5 Plan change

1. Product authorization and recent-auth checks.
2. Validate source/target offers and provider capabilities.
3. Persist idempotent attempt.
4. Request explicit immediate or next-date change and explicit proration.
5. Persist any payment/action URL without granting target entitlement.
6. Apply target only after verified snapshot.
7. Duplicate request returns prior attempt/result.

### 12.6 Portal and cancellation

Portal uses a persisted customer and allowlisted return URL. Cancellation is idempotent and records immediate versus scheduled behavior. The product entitlement resolver decides paid-through access.

### 12.7 Reconciliation

An app worker asks the package to claim due reconciliation jobs and applies the same transitions as webhooks. Claiming uses a committed lease; FOR UPDATE SKIP LOCKED may select work inside the claim transaction but no row lock is held across the provider call. It covers:

- Missing/delayed webhooks.
- Remote success before local failure.
- Stuck checkout/plan-change attempts.
- Periodic active/past-due verification.
- Operator-requested repair.

Work is idempotent, bounded, observable, and retryable.

Reconciliation selects the adapter recorded on each subscription/attempt, not the current checkout provider. Provider outage is isolated per record and never downgrades a verified active entitlement. Locally elapsed trial, paid-through, or grace boundaries are still enforced without waiting for the provider.

The package exports bounded work units—runWebhookInboxBatch, runReconciliationBatch, runDeadlineBatch, verifyRequestedCatalog, and purgeExpiredSensitiveValues—but does not start timers or choose cron infrastructure. The application scheduler may invoke them from an API process, worker, or external job runner. Multi-instance correctness comes from database claims, not a process-local running flag.

### 12.8 Safe read models and workflow outcomes

Applications should not rebuild payment semantics in every route. The package exports provider-free base read models:

    PublicBillingCatalog<PlanId, OfferKey> = {
      revision
      currency
      checkoutAvailable
      offers: { key, plan, interval, amountMinor, currency, displayTrialDays }[]
    }

    CommercialBillingState<PlanId, OfferKey> = {
      activePaidPlan: PlanId | null
      billingInterval: BillingInterval | null
      subscriptionStatus: CanonicalSubscriptionStatus | null
      providerTrialEndsAt
      currentPeriodEndsAt
      paidThroughAt
      cancelAtPeriodEnd
      pendingCheckout
      pendingPlanChange
      projectionVersion
    }

The product composes this with deployment mode, app trial/grace, entitlements, usage, availability, and canManageBilling. Those fields cannot be safely generalized from SendLit's organization summary. Ordinary reads use the verified local projection and never call the provider. The package does not impose a cache, but projectionVersion may key or invalidate an application cache; final entitlement checks bypass stale caches.

Workflows return typed results and a stable, provider-neutral error taxonomy rather than HTTP status codes or message matching. Initial codes include catalog_changed, catalog_unavailable, provider_unavailable, active_subscription_exists, checkout_pending, subscription_required, subscription_not_changeable, plan_change_pending, plan_change_not_supported, same_offer, payer_mismatch, operation_conflicted, and operation_quarantined. An error declares retryability and exposes only allowlisted safe details. catalog_changed may include the current public catalog; no error includes provider SDK text or identifiers. REST, MCP, CLI, and UI mappings remain application code.

### 12.9 Sensitive action authorization

SendLit's human-session, recent-auth, Origin, CSRF, Better Auth verification-table token, and HTTP-header implementation belongs in the Platform/application layer. The reusable billing contract is narrower:

    BillingActionGrant = {
      grantId
      actorId
      action
      target
      issuedAt
      expiresAt
    }

    BillingAuthorizationPort.consume(grant, expectedAction, expectedTarget)

Externally initiated checkout, portal, plan change, cancellation, and payer transfer require a single-use application-issued grant before the package mutates state or calls a provider. The application uses the same port around product-owned entity close and billing-manager lifecycle mutations. It decides how it proves recent human authentication; the Platform reference adapter can implement the SendLit five-minute, user/session/action/target-bound token pattern. Webhook and scheduled reconciliation enter through separate trusted system workflows and cannot present a human grant. Product-authenticated operator surfaces use OperatorContext and their own stronger authorization policy rather than impersonating a customer action token.

The grant proves authorization freshness, not billing ownership. The workflow independently compares the actor/payer with the persisted checkout, customer, and subscription association. This defense remains even when an app has an authorization bug.

### 12.10 Operator and health surfaces

The package exports services, not an unauthenticated script, for generic recovery:

- Inspect, record, verify, and abandon catalog revisions.
- Inspect a billable entity's canonical commercial state and blockers.
- Reconcile one subscription or other canonical subject from current provider truth.
- Inspect normalized webhook metadata; decrypt replay material only through the injected sensitive-value port.
- Retry, release, or quarantine a webhook/reconciliation job under an explicit retry policy.
- Request idempotent provider cancellation without projecting entitlement ahead of provider truth.

Every mutating operator call requires OperatorContext with actorId, bounded reason, and optional external ticket reference. It writes the required audit hook transactionally. Sensitive-value access is separately audited even when it makes no state change. “Retry” must state whether it preserves the attempt counter or starts a new audited operator retry budget; directly setting status=pending is not a public API.

Product operations remain product code: negotiated entitlement adjustments, SendLit reputation controls, school trial changes, and any lifecycle consequence. An application CLI may compose generic and product commands behind one interface.

The maintenance module also returns neutral health facts—oldest inbox age, quarantined counts, stuck creating operations, unreconciled subscriptions, invalid requested catalog, lease expiry/reclaim counts, and last successful batch timestamps. Thresholds, cooldowns, PostHog/Pino/email integration, paging recipients, and messages are application operations policy.

## 13. Subscription versus entitlement

The package normalizes commercial state but does not decide access:

    provider snapshot -> canonical subscription -> active-subscription pointer
                                                    |
    app trial --------------------------------------+
    deployment mode --------------------------------+-> app entitlement resolver
    app grace/expiry policy ------------------------+
    app plan policy/adjustments --------------------+-> capabilities/availability

The package projects verified commercial truth; it does not project a product fallback plan. The product combines deployment mode, app trial, canonical subscription, paid-through dates, app grace/expiry policy, plan policy, negotiated adjustments, and injected current time.

Routes do not compare plan strings. Products expose central resolveEntitlements, assertCapability, and atomic quota/reservation operations.

Consequences remain product-owned. CourseLit derives public school availability synchronously from time and state; it cannot rely only on a cron-updated column. SendLit independently decides sending and provisioning access.

## 14. Trials and OSS

The package offers time-window and durable-claim primitives but no universal trial.

CourseLit:

- Each new Cloud school gets a cardless 14-day app-managed trial.
- Trial identity survives rename/delete/restore/ownership changes per CourseLit policy.
- It creates no fake provider subscription.
- Expiry makes public school functionality unavailable while admin billing/recovery remains.
- Subscription recovery restores that school only.

SendLit:

- Cloud Free remains an application plan.
- Provider/application trial details remain SendLit policy.

OSS:

- The entire deployment explicitly selects OSS.
- All commercially gated capability is unlocked.
- Billing routes/UI are disabled and no provider/catalog is required.
- Operational abuse/safety limits can still apply.

Environment variable names and mode validation stay in each app.

## 15. Usage and quotas

SendLit's billing area contains a sound concurrency pattern: reserve capacity before an asynchronous side effect, include committed plus reserved usage in the decision, commit after provider acceptance, release after a definitive non-acceptance, and settle expired reservations by checking the durable outbound record. A stable operation identity makes retries reuse one reservation, and an elapsed bucket is released/re-reserved atomically before work proceeds.

That is a generic reservation primitive, but it is not automatically a billing primitive. Version 1 leaves SendLit's send buckets/reservations in SendLit and records characterization tests for reserve, commit, release, retry, bucket rollover, and crash settlement. Extract it only after CourseLit or another consumer demonstrates the same state machine, likely as a separate metering/quota module or package.

The boundaries are:

- Product capability and capacity adjustments—including SendLit's negotiated Business team/contact limits—belong to the application policy/adjustment table.
- Dimension names, aggregation windows, reset rules, counting queries, enforcement surfaces, and reputation/safety decisions belong to the application.
- A future generic metering component may own idempotent measurement and reservation mechanics.
- Monetary overage rating, provider usage reporting, invoices, and prepaid credits are a separate future billing capability; nothing in SendLit's current fixed-price implementation proves that abstraction yet.

The billing package can carry opaque entitlement/usage summaries through composition helpers, but it never interprets them or writes product overrides into billing_plan_states.

## 16. Security invariants

- Verify webhook signatures over the exact raw body.
- Uniquely constrain event IDs and operation idempotency keys.
- Build return/cancel URLs from product allowlists.
- Put only bounded opaque IDs in provider metadata.
- Inject provider credentials; never return them in results.
- Expose stable error categories, not SDK bodies.
- Require an application-issued, single-use action grant for sensitive human workflows and consume it before provider mutation.
- Keep session, recent-auth, Origin, CSRF, and transport enforcement in the app/Platform adapter.
- Scope customers by payer/provider and subscriptions by stored entity association.
- Prevent older webhooks from regressing state.
- Enforce at most one entitlement-producing subscription per billable entity.
- Let apps define retention while preserving required immutable history.
- Keep analytics separate from billing audit.
- Require actor/reason audit for operator mutation and separate audit for replay-payload decryption.

## 17. Telemetry

Billing accepts a tiny injected sink:

    BillingTelemetry {
      event(engineEvent, allowlistedProperties)
      error(error, safeContext)
    }

Default is no-op. Engine events cover attempts, provider failure, duplicate webhook, material/no-op projection, lease recovery, quarantine, and reconciliation recovery. The maintenance API exposes queryable health facts separately from emitted telemetry. Product lifecycle analytics, alert thresholds/delivery, and customer notifications remain in the app.

Only opaque entity/attempt/provider identifiers enter telemetry. Emails, money instrument data, raw webhook bodies, tokens, reasons that may contain support context, and SDK error bodies are excluded. Telemetry failure cannot affect a result. Audit failure does fail the transaction when an audit hook is required.

## 18. Tests

Core:

- Table-driven transition tests.
- Exact provider-trial, paid-through, period-end, observation, and provider-version boundaries.
- Money/currency/catalog invariants.
- Property-based duplicate and out-of-order sequences.
- Concurrent checkout/customer/change/webhook idempotency.
- Fault injection at every remote-call/local-write boundary.
- Stable public catalog/read-model redaction and workflow error details.
- Material snapshot diff: an equivalent refresh changes freshness only; a real change increments projectionVersion and emits one effect.

Schema generator and Drizzle adapter:

- Configuration validation for model imports, ID types, table names, plan IDs, and deletion rules.
- Deterministic generation and generate --check drift detection.
- Generated source compiles against the configured external tables.
- Every canonical index, check, and partial unique constraint is present.
- Exact catalog revision/attempt lineage survives price-entry reuse and plan changes.
- Existing compatible schemas can be mapped without destructive table duplication.
- An empty database can apply the generated application migration.
- Package import and runtime startup execute no DDL.
- Adapter transactions, locks, and idempotency pass on PGlite where supported and real PostgreSQL for production semantics.
- Reconciliation/webhook leases are exclusively claimed, expire, and are reclaimed after a simulated worker crash; no transaction spans the injected provider call.

Provider contract:

- Customer, checkout, plan-change, and cancellation idempotency/recovery.
- Product/subscription normalization.
- Capability accuracy.
- Portal, change, cancel, and retrieval behavior.
- Valid/invalid raw-body signatures.
- Webhook verification returns a durable envelope independently from subscription retrieval.
- Stable error mapping.
- Duplicate event identity and redaction.
- Mutation retries reuse the same idempotency key after an ambiguous timeout.
- A provider cannot declare an idempotency/lookup capability that the contract's side-effect-then-timeout scenario disproves.

Live provider sandbox tests run separately from deterministic CI.

Consumer conformance:

- SendLit OSS unlimited and Cloud Free/Pro/Business remain unchanged.
- CourseLit OSS unlimited and Cloud trial/Pro/Business contain no Free state.
- Two CourseLit schools under one payer transition independently.
- Advancing beyond 14 days disables only an unpaid school.
- Duplicate/out-of-order events neither duplicate nor regress entitlement.
- Delayed webhooks trigger current-snapshot retrieval before projection.
- Remote success plus local failure reconciles.
- New checkout can use a new provider while old-provider subscriptions continue reconciling.
- Entity close and payer demotion/deletion observe canonical blockers under concurrent billing activity.
- A fresh action grant cannot bypass a persisted payer mismatch, and a grant is consumed once.
- Generic operator mutation requires actor/reason audit; sensitive replay inspection creates a separate audit effect.
- Product grace/trial/adjustment policy composes with the commercial state without changing canonical billing rows.

Use PGlite for fast integration and real PostgreSQL for locking, uniqueness, isolation, and migrations.

## 19. SendLit extraction map

The current SendLit branch is the origin implementation. Its files divide as follows:

| SendLit area                                       | Version 1 treatment                                                   | Reason                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| billing/provider.ts                                | Extract now and strengthen                                            | Canonical provider types, capabilities, errors, snapshots, and adapter interface are product-neutral after metadata/time semantics are generalized; mutation recovery capability must become explicit                                                   |
| billing/provider-registry.ts                       | Extract now                                                           | Registry can be instance-based and configured by the consumer                                                                                                                                                                                           |
| billing/providers/dodo                             | Extract now after constructor/metadata cleanup                        | SDK translation, signature verification, error normalization, and provider capability mapping are reusable                                                                                                                                              |
| billing/providers/fake                             | Extract now after removing SendLit catalog defaults                   | Deterministic provider and scenario controls are essential consumer fixtures                                                                                                                                                                            |
| billing/provider-contract.ts                       | Extract now and substantially expand                                  | Becomes the acceptance contract for every provider; current tests cover the fake's happy path but not side-effect-then-timeout recovery for all mutations or capability truthfulness                                                                    |
| billing/webhook-retry.ts                           | Extract as configurable pure policy                                   | Attempt/backoff/quarantine decision has no product persistence dependency                                                                                                                                                                               |
| billing/catalog.ts                                 | Split                                                                 | Extract money, offer, provider-set, and validation primitives; retain SendLit env names, exact keys, plan union, trial HMAC, and Free policy                                                                                                            |
| billing/catalog-store.ts                           | Split                                                                 | Extract revision/price invariants, exact required-offer set, public catalog projection, and canonical persistence; retain alert delivery and app authorization in SendLit                                                                               |
| billing/checkout.ts                                | Split, do not move wholesale                                          | Extract canonical attempt persistence/transitions/idempotency into package workflows; retain organisation creation, Free policy, payer lookup, SendLit trial claim, URLs, authorization, and product hooks                                              |
| billing/plan-change.ts                             | Split, do not move wholesale                                          | Extract canonical attempt persistence/transitions/provider invocation; retain plan ranking, effective-time policy, authorization, API errors, and product hooks                                                                                         |
| billing/portal.ts                                  | Split                                                                 | Extract stored-payer/customer invariant and provider invocation; retain owner/session authorization, return URL, and route response in SendLit                                                                                                          |
| billing/webhooks/processor.ts                      | Split aggressively                                                    | Extract correlation, canonical subscription/attempt projection, material-diff/version behavior, exact catalog lineage, and event classification; retain first-team creation, Free fallback policy, product audit implementation, and notification hooks |
| billing/webhooks/routes.ts                         | Keep app transport                                                    | Express ordering, raw-body limits, encryption storage, HTTP response, and enabled-provider routing belong to the app/platform                                                                                                                           |
| billing/reconciliation.ts                          | Keep timer composition; extract billing work units and durable claims | Current file also runs send-reservation, reputation, and domain jobs. Product owns when/where jobs run; package owns canonical billing claims, bounded batches, and reconcile-one functions                                                             |
| billing/crypto.ts                                  | Keep app/platform security                                            | Secret sourcing, envelope keys, rotation, retention, and audited decryption are deployment responsibilities                                                                                                                                             |
| billing/policies.ts                                | Keep SendLit                                                          | Contains Free/Pro/Business capabilities, grace results, and mail policy                                                                                                                                                                                 |
| billing/entitlements.ts and errors.ts              | Keep SendLit initially                                                | Organisation/team/contact/send guards and plan-gate responses are product domain. Preserve reservation characterization as evidence for a possible later metering extraction                                                                            |
| billing/usage.ts                                   | Keep SendLit                                                          | Organisation send/contact/team dimensions and counting queries are not generic billing                                                                                                                                                                  |
| billing/reputation*, domains.ts                    | Keep SendLit                                                          | Deliverability, sending ramp, and DNS ownership are SendLit product operations                                                                                                                                                                          |
| billing/security.ts                                | Split contract from implementation                                    | Better Auth verification rows, human session, CSRF, Origin, and token issuance stay Platform/SendLit; package workflows consume an opaque single-use action grant and still enforce persisted payer identity                                            |
| billing/routes.ts and api-contract billing schemas | Split safe projections from transport                                 | ts-rest routes, authorization, caching headers, entitlement/usage composition, and HTTP mapping stay in SendLit; provider-free catalog/commercial-state DTOs and workflow error codes are reusable                                                      |
| billing/alerts.ts, metrics.ts, notifications.ts    | Split facts from policy                                               | Canonical health queries and engine events are reusable; thresholds, cooldowns, Pino/PostHog/email delivery, recipients, and customer messages stay in SendLit                                                                                          |
| scripts/billing.ts                                 | Replace direct canonical writes with composed operation services      | Catalog inspection/verification/abandonment, reconcile, webhook retry/inspect, and cancellation use package operations with actor/reason audit; overrides and reputation remain SendLit commands                                                        |
| organization/queries.ts billing lifecycle checks   | Extract blocker queries and lock order                                | Close and payer-responsibility facts are canonical; role mutation, entity status, audit noun, and user-facing behavior stay SendLit                                                                                                                     |
| db/schema.ts canonical billing models              | Convert to package schema specification                               | Generator reproduces compatible tables and configured organisation/user foreign keys; SendLit owns the checked-in output and migration, which should be a no-op for already-compatible structures                                                       |
| db/schema.ts product billing extensions            | Keep SendLit                                                          | Trial claims, usage, reputation, domains, audit, and lifecycle columns/tables are not canonical generated models                                                                                                                                        |

This map is deliberately asymmetric: extracting a provider class is safe early; extracting an organisation checkout coordinator before CourseLit supplies a second persistence implementation would merely hide SendLit behind generic type names.

### Stable, experimental, and application APIs

The first releases label exports:

- Stable: core money/status types, schema configuration/generator, Drizzle adapter, provider contract/registry, Dodo, fake, provider/workflow error normalization, pure state/diff guards, safe catalog projection, catalog validation, and testing.
- Experimental: commercial-state read model, cross-boundary workflows, action-grant port, blocker queries, operator services, maintenance claims/health, and transactional lifecycle hooks until both SendLit and CourseLit consume them.
- Application-only: authentication/token issuance, plan/entitlement policy, adjustments, usage, transport routes, schema extensions/migrations/backfills, UI, audit storage, alerts/notifications, scheduler composition, and product entity lifecycle.

Experimental exports can change within documented pre-1.0 rules. Version 1 requires the two-consumer proof described below.

## 20. Pre-extraction ADRs and implementation discrepancies

The PRD and current branch disagree or leave ambiguity in several places. Resolve these with characterization tests and ADRs before freezing public package behavior:

1. Cancellation recovery: the PRD transition table permits cancelled only to expired, while the implemented processor permits cancelled to trialing, active, or past_due to support provider recovery before paid-through expiry. Provider sandbox evidence and desired recovery semantics decide the canonical transition.
2. Pending status: the implementation's SubscriptionSnapshot includes pending while the PRD adapter excerpt omits it. The shared canonical status should include pending because durable checkout can observe it.
3. Webhook type shape: the implementation can persist a canonical snapshot in its encrypted envelope but intentionally retrieves current provider state before projection. Public types must separate verified event evidence from authoritative retrieved snapshot.
4. Catalog availability: configuration validation is synchronous, provider verification is asynchronous, and a pending/invalid requested revision freezes only checkout—not ordinary API readiness or existing entitlement.
5. Provider cancellation: implemented adapters and tests require cancelSubscription although the PRD interface excerpt omits it.
6. Metadata: sendlitCheckoutAttemptId must become a namespaced generic attempt-correlation field configured by the consumer; no SendLit key may remain in Dodo/fake output.
7. Clock usage: current code frequently calls new Date and Date.now. Extraction introduces an injected Clock before time-boundary behavior becomes public.
8. Reconciliation claims: some SendLit reconciliation reads use row locks outside an explicit transaction, and a row lock cannot safely protect a later provider call without violating the no-transaction-across-network rule. Extraction replaces this with committed billing_reconciliation_jobs leases and real PostgreSQL crash/reclaim tests.
9. Catalog failure transition: marking an active revision invalid freezes checkout. The package must define whether the last verified revision remains active-but-unavailable or becomes invalid, so rolling deployments and operator abandonment behave consistently.
10. Existing-schema mapping: generator configuration must reproduce SendLit's current table/column/index names and constraints without creating parallel generic tables or destructive renames.
11. Configuration loading: billing.config.ts must be a deterministic schema description that does not boot the application, connect to databases, or require provider secrets merely to generate code.
12. Plan constraints: adding/removing a configured paid plan ID can change a generated database check constraint and therefore follows schema-change SemVer and migration guidance.
13. Catalog provenance: SendLit subscriptions store a price entry and offer key but not the exact accepted catalog revision; one price entry can appear in several revisions, and current plan-change code can only infer a latest revision. The generated subscription must persist exact initial/last-confirmed revision lineage and update it only from the correlated checkout/change attempt.
14. Projection idempotency: SendLit currently increments projectionVersion on every accepted current snapshot even when commercial state is unchanged, although the PRD requires replay to be a no-op without duplicate audit. Define the material-field diff and freshness-only update before exposing projectionVersion for cache invalidation.
15. Snapshot time: Dodo retrieval currently assigns new Date as occurredAt. The public model must separate provider change/version time from observedAt; retrieval time cannot be used as proof that the provider state changed after another snapshot.
16. Payer invariant: SendLit's routes authorize an owner/billing manager, but the reusable workflow must also compare the persisted payer/customer/subscription association. Define portal, plan-change, cancellation, account deletion, and future transfer behavior without importing membership roles.
17. Sensitive action seam: SendLit's Better Auth verification-row action token is a sound Platform adapter, not billing persistence. Freeze the opaque consume-once grant contract and protected-action list while leaving session freshness, CSRF, Origin, headers, and token table to Platform/apps.
18. Operator audit: current catalog abandonment and override commands record a metric with reason, and webhook retry directly rewrites state; this does not satisfy the PRD's immutable operator audit requirement. Generic operations require actor/reason/effect audit, explicit retry-budget semantics, and an audited sensitive-decryption port.
19. Read-model boundary: SendLit's catalog DTO is reusable, while its billing summary mixes commercial state with owner authorization, entitlements, and usage. Export only the safe generic base projections and stable workflow errors; product composition and transport status remain outside.
20. Provider recovery declaration: current interfaces accept idempotency keys but do not state or fully test whether each provider mutation honors them. Add per-operation recovery capabilities and side-effect-then-timeout contract cases before a provider is production-eligible.
21. Plan-state boundary: SendLit's plan state stores Free and product adjustment/ramp columns. The canonical generated model owns only the active paid-subscription pointer and projection version; SendLit's plan/override/ramp fields map as application extensions rather than defining every consumer's no-subscription state.
22. Required audit hook: product audit storage stays outside the package, but state-changing/operator workflows cannot make it optional in Cloud composition. Define stable effect IDs, safe canonical diffs, transactional failure behavior, and idempotent outbox use.

These are not reasons to redesign SendLit during extraction. The default is behavioral compatibility unless the ADR identifies a correctness defect and both the migration and tests are explicit.

## 21. Release policy

- Changesets and SemVer.
- Provenance and generated API reports.
- Patch: public-type and state-semantic preserving.
- Minor: additive capability/provider/workflow.
- Major: removed contract, changed normalized meaning, or required migration.
- Every release has a migration guide and tested provider SDK versions.
- Platform preset records compatible versions, but billing stays independently installable.
- Package install/import/startup never runs database migrations or DDL.
- Schema-changing releases include generator changelog, generated reference diff, compatibility range, and expand/backfill/enforce guidance.
- Generated schema format/version is part of compatibility; generate --check detects stale application artifacts.
- Provider normalization changes require transition fixtures and an origin-product canary even without a type change.

## 22. Extraction and rollout

### Phase 0 — Characterize SendLit

- Inventory catalog, provider, checkout, portal, change, webhook, reconciliation, entitlement, security, trial, usage, alert, and notification behavior.
- Add characterization tests to every money/entitlement path.
- Characterize safe catalog/commercial read projections, workflow error codes, payer blockers, operator behavior, and equivalent-snapshot replay.
- Record constraints and recovery procedures.
- Mark product-specific policy that stays in SendLit.

Exit: behavior is provable before code moves.

### Phase 1 — Core and providers

- Extract canonical types, stable workflow errors, clock, transition/diff guards, provider interface, Dodo, fake, and provider contracts.
- Replace SendLit metadata with bounded generic metadata.
- Separate provider occurrence/version from local observation and prove mutation recovery capabilities with ambiguous-timeout tests.
- Keep orchestration in SendLit initially.

Exit: SendLit consumes public provider/core exports without changed behavior.

### Phase 2 — Catalog

- Extract offer validation, exact offer-set/provider verification, revision invariants, provider-safe public projection, and test helpers.
- Keep environment parsing and exact offers in SendLit.
- Migrate SendLit to public catalog exports.

Exit: old and new SendLit subscriptions resolve identical catalog history.

### Phase 3 — Schema generator, Drizzle adapter, and workflows

- Define the canonical schema model, configuration, deterministic generator, check mode, and Drizzle adapter.
- Include exact subscription catalog lineage, the narrow active-subscription projection, and durable reconciliation jobs.
- Configure SendLit table/column/model mappings so generation matches its existing compatible billing tables rather than creating parallel tables.
- Treat any generated SendLit SQL as a reviewed application migration; extraction should be a no-op where existing constraints already match.
- Move canonical persistence into the adapter and add product lifecycle hooks one workflow at a time.
- Add material projection diff/versioning, blocker queries, action-grant consumption, required audit effects, generic operator services, and neutral health facts.
- Keep cross-boundary workflow/hook contracts experimental.
- Migrate SendLit first while its routes, auth, plan policy, extensions, and operational effects remain.
- Fault-inject every provider/local boundary and worker-lease crash point.

Exit: SendLit imports no private billing code; generate --check passes; no parallel billing tables or unplanned destructive migration are produced; and characterization, adapter, conformance, and sandbox tests pass. Do not declare cross-boundary workflow hooks stable yet.

### Phase 4 — CourseLit

- Configure and generate CourseLit's canonical billing schema with real school and payer-account foreign keys.
- Generate, review, and apply CourseLit's application migration through drizzle-kit.
- Supply four paid offers and no-Free policy.
- Implement durable per-school 14-day trials and synchronous availability.
- Keep CourseLit trial/availability/audit extensions outside billing.generated.ts.
- Reuse provider/core/generator/adapter/workflow suites.
- Compose CourseLit's Platform action-grant adapter and product-authenticated operator CLI/admin surface.

Exit: one owner can independently trial, subscribe, change, cancel, expire, and recover two schools.

### Phase 5 — Stabilize from two consumers

- Compare generated mappings, product hooks, and workflows.
- Compare payer/lifecycle blockers, safe read composition, action grants, operations, health, and maintenance claims.
- Share only genuinely identical mechanics.
- Keep trial, grace, usage, notification, and deletion differences in products.
- Promote only lifecycle hooks and workflows proven by both consumers from experimental to stable.
- Publish version 1 after both run production canaries.

### Phase 6 — FrontLit and MediaLit

- Adopt with their own aggregates and policy.
- Add generic seams only for concrete consumer needs.
- Return improvements through releases, conformance, and explicit migrations.

## 23. Operational runbooks required

- Webhook outage and replay.
- Catalog mismatch at startup.
- Stuck checkout/change.
- Remote success with failed local persistence.
- Duplicate provider customer.
- Conflicting active subscriptions.
- Manual reconciliation with immutable correction/audit.
- Reconciliation lease exhaustion, reclaim, and quarantine.
- Entity close or payer removal blocked by live billing responsibility.
- Sensitive action-token outage/replay and persisted payer mismatch.
- Operator retry-budget reset versus preservation.
- Audited replay-payload inspection and retention purge.
- Provider credential rotation.
- Package rollback with app-owned migrations.
- CourseLit trial/subscription expiry and public-availability verification.

Runbooks use product-owned authenticated commands/screens composed over package operation services so authorization, audit storage, and product nouns remain correct.

## 24. Version 1 definition of done

- SendLit is first production consumer and preserves Cloud Free/Pro/Business and OSS.
- CourseLit is second and provides per-school Cloud trial/Pro/Business and OSS with no Cloud Free state.
- Dodo and fake pass the same public provider suite, including declared mutation recovery after ambiguous side effects.
- Catalog revisions are immutable and provider-verified.
- Public catalog/commercial-state projections and stable workflow errors contain no provider IDs or SDK text.
- The reference app generates its canonical Drizzle billing schema from billing.config.ts, commits the result, and creates/applies its migration through drizzle-kit.
- generate --check detects schema drift, and package install/import/API/worker startup performs no DDL.
- SendLit maps its existing compatible schema without parallel tables or an unplanned destructive migration.
- CourseLit generates real foreign keys to schools and payer accounts.
- Subscriptions retain exact checkout/plan-change catalog lineage even when price entries are reused.
- Checkout, change, cancel, webhook, and reconciliation are idempotent and fault-tested.
- Equivalent snapshots are freshness-only no-ops; material snapshots increment projectionVersion and emit one audited effect.
- Verified webhook evidence is stored before 2xx and current provider state is retrieved before subscription projection.
- Multi-instance reconciliation uses committed reclaimable leases and no database transaction spans a provider call.
- Lifecycle blocker queries protect billable-entity and payer mutations, and persisted payer checks cannot be bypassed by route authorization.
- Sensitive workflows consume app-issued action grants; generic operator mutations require actor/reason audit and sensitive reads are audited.
- New checkout provider selection coexists safely with retained historical providers.
- Product policy, entitlements/adjustments, metering, schema extensions, migrations/backfills, routes, auth/token issuance, UI, audit-table implementation, alert delivery, and notifications stay outside.
- Packed public exports are documented and tested.
- One upgrade rolls through SendLit and CourseLit with a guide and canary.

## 25. Deferred decisions

- Whether additional ORM adapters warrant first-party generators/runtime adapters.
- Whether metering is part of billing or a separate package.
- Whether new provider adapters split into separate packages.
- Whether app-managed invoices need canonical types.
- Multi-currency catalogs.
- Tax and merchant-of-record abstractions.

Working consumers and provider requirements—not speculative generalization—decide these.
