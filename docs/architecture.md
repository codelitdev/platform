# CodeLit Platform architecture

Status: accepted for staged implementation  
Audience: CourseLit, SendLit, FrontLit, MediaLit, and platform maintainers  
Package manager and runtime: Bun

## 1. Purpose

CodeLit Platform is the reusable application kernel and bootstrap system for CodeLit SaaS products. It lets products share a proven implementation of:

- TypeScript monorepo and build conventions.
- Express and ts-rest APIs with generated OpenAPI.
- Better Auth and @codelitdev/oauth-server-kit.
- Tenant selection, membership, API-key, and authorization conventions.
- REST and MCP parity over common application services.
- Optional PostHog analytics, exception capture, and log delivery.
- PostgreSQL, Drizzle, PGlite, Docker, CI, and release conventions.
- SaaS billing through the independently published @codelitdev/billing.
- A small Next.js admin shell using @codelitdev/design-system and shadcn.

This is a software factory in the product-line sense: it standardizes how a product is created and evolved while each product retains its own domain, policies, data, user experience, and deployment.

It is not a hosted control plane or a superclass application from which products inherit at runtime.

### Current shared-package baseline

@codelitdev/billing, @codelitdev/oauth-server-kit, and @codelitdev/design-system were originally developed and published from separate repositories. Their source now lives in this Platform monorepo. @codelitdev/platform, @codelitdev/mcp-server-kit, @codelitdev/observability, the preset, conformance package, CLI, reference product, and template are target packages and do not exist yet. Existing published package names and public contracts remain intact; moving source does not turn the packages into one runtime or require synchronized versions.

@codelitdev/billing is already an official package and SendLit is its first production consumer. Its current published line is pre-1.0; provider/core/schema behavior is reusable now, while cross-product workflows, action grants, operator services, and lifecycle hooks remain experimental until CourseLit proves the same contracts as the second consumer. SendLit and every other product continue consuming the package through the registry rather than importing workspace source.

Current repository state: root Git/Bun workspace normalization, one lockfile, Changesets, pinned CI, stable release automation, and packed-artifact checks are complete. Imported repository archival/redirects and the remaining packages, examples, compatibility manifest, conformance suites, and templates are pending.

## 2. Goals

1. A new product quickly proves a production-shaped vertical:

       sign in
         -> create/select tenant
         -> REST operation and equivalent MCP tool
         -> authorized, audited mutation
         -> billing entitlement decision
         -> optional telemetry

2. Security-critical improvements can be implemented once and adopted predictably.
3. Generated applications remain ordinary TypeScript repositories.
4. Product behavior is not forced into generic abstractions.
5. OSS and cloud follow consistent technical conventions without sharing commercial policy.
6. Existing products can adopt one concern at a time.

## 3. Non-goals

The platform does not own:

- Courses, products, contacts, email, pages, media, communities, or other domains.
- A universal tenant noun; products may use school, organisation, team, workspace, or app.
- Product roles, permission names, plans, capabilities, quotas, trials, or grace periods.
- Product database schemas, migrations, retention, or deletion.
- Product API contracts, MCP descriptions, or screens.
- A shared database or synchronized deployments.
- CourseLit learner authentication or school storefront checkout.
- Automatic re-merging of a newer template into generated repositories.
- A single synchronized version or release train for all Platform packages.
- Moving product-domain packages into Platform merely because they use the @codelitdev scope.

## 4. Principles

### 4.1 Packages carry behavior; templates carry structure

The bootstrap template is thin. Long-lived behavior belongs in independently versioned packages. The template holds composition code, configuration, examples, and explicit application-owned seams.

Auth, MCP, observability, and billing improvements arrive as package releases. Managed files change through `platform-cli sync`; product-owned source changes are documented in release notes (ADR 0006). Existing applications never merge the template again.

### 4.2 One service, multiple transports

REST routes and MCP tools call the same framework-independent application service:

    web/API client -> ts-rest adapter --+
                                       +-> application service -> authorization
    MCP client     -> MCP adapter -----+                       -> repositories
                                                               -> audit/outbox
                                                               -> telemetry

Parity means equivalent supported capability and authorization. It does not mean mechanically generating every MCP tool from REST; descriptions, payload ergonomics, streaming, and destructive-operation safeguards remain transport-specific.

### 4.3 Products own tenancy

Platform supplies context conventions and conformance tests, not a universal tenant table. Product adapters resolve principal, selected tenant, membership, permissions, credential kind, and request ID.

An API key resolves to exactly one tenant. A human session may select among tenants, with membership revalidated on every request. Account-level endpoints are explicit and unavailable to tenant API keys unless deliberately allowed.

### 4.4 Products own persistence

Shared packages do not run product migrations or DDL. A schema-owning package such as @codelitdev/billing may generate a configured Drizzle artifact with real foreign keys to application-selected tables. The product commits that generated artifact and owns migration generation, SQL review, backfills, deployment order, transactions, retention, and deletion. Platform examples are executable integration references, not a database control plane.

### 4.5 Secure defaults

The reference implementation defaults to tenant denial, runtime request/response validation, bounded input, rate limits, safe errors, redacted telemetry, and audited sensitive mutations. Overrides are explicit and tested.

### 4.6 No hidden network dependency

Platform packages execute inside the product. Core auth, authorization, REST, and MCP cannot require a CodeLit-hosted service. Optional analytics fails harmlessly; security validation fails closed.

## 5. Boundary and repository

Platform is the source repository for shared CodeLit infrastructure packages and the product bootstrap. Products remain separate repositories and consume immutable published packages:

    Platform repository
      packages/billing/               -> @codelitdev/billing
      packages/design-system/         -> @codelitdev/design-system
      packages/oauth-server-kit/      -> @codelitdev/oauth-server-kit
      packages/mcp-server-kit/        -> @codelitdev/mcp-server-kit
      packages/observability/         -> @codelitdev/observability
      packages/platform/              -> @codelitdev/platform
      packages/platform-conformance/  -> @codelitdev/platform-conformance
      packages/platform-cli/          -> @codelitdev/platform-cli

    Generated product repository
      apps/api ---- imports published Platform packages
          |
          +-------- product services/policy -------- product PostgreSQL

      apps/web ---- imports published @codelitdev/design-system + shadcn

The arrows above express package consumption, not source co-location. `apps/api` and `apps/web` live in each generated product repository; no `@codelitdev/*` package resides inside a product's `apps/api` directory.

Target Bun workspace:

    platform/
      packages/
        billing/              @codelitdev/billing
        design-system/        @codelitdev/design-system
        oauth-server-kit/     @codelitdev/oauth-server-kit
        platform/             @codelitdev/platform
        mcp-server-kit/       @codelitdev/mcp-server-kit
        observability/        @codelitdev/observability
        platform-conformance/ @codelitdev/platform-conformance
        platform-cli/         @codelitdev/platform-cli
      templates/
        saas-product/
      examples/
        reference-product/
          apps/api/
          apps/web/
          packages/api-contract/
      docs/
        architecture.md
        adopters.md
        compatibility.md
        decisions/

The root is private workspace metadata with a `workspaces` field in
`package.json`, one `bun.lock`, shared CI, Changesets, Biome linting and
formatting, and publishing automation. Internal examples use `workspace:`
dependencies. Packed-consumer tests and real products install registry
artifacts so unpublished source coupling cannot pass unnoticed.

Packages remain independently installable, versioned, published, documented, and releasable. A Changeset bumps only affected packages and dependants whose published contract or compatibility declaration changed. The monorepo may coordinate a release, but it does not impose lockstep versions or require consumers to install a catch-all runtime.

The former billing, OAuth, and design-system repositories are archived only after relevant history, issues, release metadata, package provenance, and security reporting have been preserved or redirected. Nested `.git` directories, package-local lockfiles, copied `node_modules`, build output, and repository-level hooks do not become part of the final workspace.

## 6. Package responsibilities

### 6.1 @codelitdev/billing

Owns provider-neutral SaaS platform-billing mechanics:

- Canonical commercial state and entitlement resolution.
- Deterministic schema generation and the Drizzle persistence adapter.
- Catalog verification, customer, checkout, webhook, plan-change, portal, cancellation, and reconciliation workflows.
- Provider contracts and provider-specific adapters.
- Operator recovery services and billing conformance suites.

Products own plans, prices, trials, capability policy, billable-entity mapping, HTTP/UI surfaces, and product effects. CourseLit storefront checkout remains unrelated.

### 6.2 @codelitdev/oauth-server-kit

Owns reusable Better Auth OAuth-server behavior for browser, REST, mobile, and MCP clients. It provides protocol and framework integration without owning product tenancy, membership, roles, or authorization policy.

### 6.3 @codelitdev/design-system

Owns shared CodeLit design tokens, visual primitives, assets, Tailwind conventions, and supported shadcn composition patterns. It does not own product navigation, workflows, information architecture, or domain screens.

### 6.4 @codelitdev/platform

A small composition kernel providing:

- Request-context and credential-kind types.
- Typed service results and safe errors.
- UUIDv7 and prefixed public-ID helpers.
- Health, readiness, graceful shutdown, and request correlation.
- Safe HTTP mapping and date serialization conventions.
- Narrow auth, authorization, telemetry, and audit seams.

It imports no product schema and defines no base repository. A public seam needs the reference app and at least one real consumer.

The version-1 kernel contract is deliberately small:

```ts
type CredentialKind = "session" | "oauth" | "api_key" | "system";

interface PlatformCredential {
  kind: CredentialKind;
  credentialId?: string;
}

interface PlatformRequestContext<
  PrincipalId extends string,
  TenantId extends string,
  Permission extends string,
> {
  requestId: string;
  principalId: PrincipalId;
  tenantId: TenantId | null;
  credential: PlatformCredential;
  permissions: ReadonlySet<Permission>;
}

type AuthenticationResult<PrincipalId extends string> =
  | {
      kind: "authenticated";
      principalId: PrincipalId;
      credential: PlatformCredential;
    }
  | { kind: "absent" }
  | { kind: "rejected"; error: PlatformError };

interface AuthenticationAdapter<Request, PrincipalId extends string> {
  authenticate(request: Request): Promise<AuthenticationResult<PrincipalId>>;
}

interface TenantContextAdapter<
  PrincipalId extends string,
  TenantId extends string,
  Permission extends string,
> {
  resolve(input: {
    principalId: PrincipalId;
    credential: CredentialKind;
    requestedTenantId: TenantId | null;
  }): Promise<{
    tenantId: TenantId | null;
    permissions: ReadonlySet<Permission>;
  }>;
}

type PlatformErrorCode =
  | "unauthenticated"
  | "credential_ambiguous"
  | "tenant_required"
  | "tenant_forbidden"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation_failed"
  | "rate_limited"
  | "internal_error";

interface PlatformError {
  code: PlatformErrorCode;
  message: string;
  safeDetails?: Readonly<Record<string, string | number | boolean | null>>;
  cause?: unknown;
}

interface AuthorizationAdapter<Context, Action extends string, Resource> {
  authorize(input: {
    context: Context;
    action: Action;
    resource: Resource;
  }): Promise<{ allowed: true } | { allowed: false; error: PlatformError }>;
}

interface AuditPort<Context, Event> {
  record(context: Context, event: Event): Promise<void>;
}
```

Authentication establishes credential validity and principal identity only. HTTP and MCP adapters never return a `system` credential; those contexts are constructed only by trusted in-process entry points. `absent` is allowed only for a route explicitly declared public; protected HTTP and MCP adapters map it to `unauthenticated`. `rejected` covers invalid, expired, malformed, or ambiguous supplied credentials and must never fall back to another mechanism. Tenant resolution loads current membership and permissions for every tenant-scoped operation; transports never supply trusted permissions. Product services receive the normalized context and use product-owned permission strings. Products may authorize directly from the context when an operation is purely permission-based, or use `AuthorizationAdapter` when authorization also depends on a resource or product policy. An authorization denial is returned as a stable `PlatformError`; a thrown exception is always mapped to `internal_error` after sanitized capture.

`PlatformErrorCode` is the complete version-1 transport-neutral error vocabulary. `message` is a stable, public-safe message selected by the code path and never derived from `cause`; `safeDetails` may contain only scalar values approved for the public API. HTTP and MCP adapters must not expose `cause`, raw exceptions, database identifiers, secrets, or provider responses. The reference app defines and tests the canonical HTTP and MCP mapping for every code.

Security-relevant mutations record an application-owned audit event in the same transaction as the mutation when both use the same database. Telemetry is never a substitute for the audit port and never participates in the product transaction.

### 6.5 @codelitdev/mcp-server-kit

Extract stable behavior proven in FrontLit, SendLit, and MediaLit:

- Streamable HTTP transport and session lifecycle.
- CORS and protocol-header handling.
- OAuth bearer and tenant-scoped API-key hooks.
- Product context propagation into tools.
- Error mapping, cancellation, logging, and shutdown.
- Registration helpers and test harnesses.

Products own tool names, descriptions, Zod schemas, authorization, and service calls. Tool names never imply permission.

### 6.6 @codelitdev/observability

Standardize the common production patterns proven independently by SendLit API and the legacy CourseLit Queue:

- Structured stdout logging always.
- No-op analytics and exception capture without PostHog configuration.
- Typed capture with property allowlists.
- Error deduplication and per-source rate caps.
- Optional Pino OTLP delivery while preserving stdout.
- Request, BullMQ/job, webhook, and MCP correlation without requiring BullMQ in the core package.
- Idempotent initialization and bounded best-effort shutdown of PostHog, OTLP processors, and Pino transports.
- Redaction of credentials, authorization, cookies, bodies, emails, content, and payment data.
- Optional browser identify and session recording through `createBrowserObservability` (`@codelitdev/observability/browser`). Products pass the project token from request-time env; the package does not read `NEXT_PUBLIC_*` or construct `posthog-js` at import.

Products own event catalogs. Telemetry can never fail a request, webhook, migration, or worker.

The package uses explicit construction rather than reading environment variables or creating SDK clients at module import:

    createObservability({
      serviceName,
      environment,
      posthog?,
      logs?,
      contextPolicy,
      clock?,
    }) -> {
      logger,
      captureEvent,
      captureException,
      expressErrorHandler,
      shutdown,
    }

    createBrowserObservability({
      serviceName,
      environment,
      apiKey?,
      host?,
    }) -> {
      enabled,
      init,
      identify,
      reset,
    }

The application parses environment variables and supplies typed configuration. Tenant identity is a product-provided opaque `subjectId`; the package does not encode SendLit `teamId`, CourseLit `domainId`, or any other tenant noun. Product wrappers define allowed event names and properties over the generic capture API.

#### Observability extraction baseline

Reference implementations:

- `sendlit/apps/api/src/observability/posthog.ts` and `sendlit/apps/api/src/services/log.ts`.
- `courselit/apps/queue/src/observability/posthog.ts`, `courselit/apps/queue/src/observability/logs.ts`, and `courselit/apps/queue/src/bullmq.ts`.

SendLit API contributes:

- Pino stdout plus `pino-opentelemetry-transport` fan-out to PostHog's OTLP log endpoint.
- PostHog exception/event capture, Express integration, allowlisting, redaction, deduplication, per-source caps, and a best-effort client shutdown method.

CourseLit Queue contributes:

- The same independently exercised exception/event safety wrapper in a worker-heavy process.
- BullMQ ready, closed, failed, stalled, and worker-error instrumentation with tenant/job correlation.
- Direct OpenTelemetry `NodeSDK`, batch log processing, and OTLP HTTP export.
- Tests for disabled configuration, SDK failures, bounded dedupe state, configurable source caps, and conditional Express wiring.

The extraction must not copy product event names, context allowlists, environment access, Mongo logging, queue names, or tenant terminology. It must also correct current lifecycle gaps: manual and SDK Express capture cannot double-report the same exception, initialization failure must leave stdout logging usable, and shutdown must flush every configured pipeline under a caller-supplied timeout.

### 6.7 Compatibility preset

The preset ships inside @codelitdev/platform-cli as `src/preset.json` (ADR 0006). It is a tested compatibility bill of materials pinning:

- Exact compatible releases of the independently versioned Platform workspace packages and selected external peers such as dodopayments.
- Express, ts-rest, Zod, Better Auth, Drizzle, MCP SDK, Pino, Bun test, and PGlite.
- Supported Bun, TypeScript, Next.js, and React lines.

Products depend on individual packages; CI verifies that resolved versions match one preset. The preset has no runtime code.

`scripts/sync-preset.mjs` writes `recommended` from the shared release version and `external` from the template's exact versions. The manifest has this versioned shape:

```json
{
  "schemaVersion": 1,
  "runtime": {
    "bun": "1.4.1"
  },
  "packages": {
    "@codelitdev/platform": {
      "recommended": "1.2.3",
      "supported": ">=1.2.0 <2",
      "minimumSecure": "1.2.1"
    }
  },
  "external": {
    "typescript": "5.9.3"
  }
}
```

`recommended` is the exact version emitted into a new product. `supported` is the range covered by conformance for an existing adopter. `minimumSecure` is monotonic within a supported major line and makes `doctor` and conformance fail when the resolved version is older. The preset validates the product manifest and lockfile; it does not mutate dependencies. Dependabot performs upgrades through reviewable product pull requests.

### 6.8 @codelitdev/platform-conformance

Applications provide an adapter and run shared suites for:

- Session, OAuth, API-key, and system contexts.
- Tenant selection and cross-tenant denial.
- API keys fixed to one tenant.
- Product-supplied owner/membership invariants.
- REST validation and standard errors.
- MCP authentication and parity.
- OpenAPI drift.
- Telemetry on/off, redaction, and failure isolation.
- @codelitdev/billing Cloud/OSS composition when installed: generated-schema drift, action-grant adapter, audit/lifecycle hooks, fake provider, and maintenance invocation.
- Health, readiness, and shutdown.

The package defines Platform composition behavior; applications own fixtures and databases. It invokes @codelitdev/billing's own provider/workflow/consumer suites rather than duplicating the billing engine's conformance tests.

The version-1 conformance entry point accepts a generic adapter rather than importing product internals:

```ts
interface PlatformConformanceAdapter<
  Principal,
  Tenant,
  SessionCredential,
  OAuthCredential,
  ApiKeyCredential,
  HttpInput,
  McpInput,
  McpOutput,
  AuditEvent,
> {
  reset(): Promise<void>;
  fixtures: {
    owner: Principal;
    member: Principal;
    outsider: Principal;
    tenantA: Tenant;
    tenantB: Tenant;
  };
  credentials: {
    session(principal: Principal): Promise<SessionCredential>;
    oauth(principal: Principal): Promise<OAuthCredential>;
    apiKey(
      tenant: Tenant,
      permissions: readonly string[],
    ): Promise<ApiKeyCredential>;
  };
  http(input: HttpInput): Promise<{ status: number; body: unknown }>;
  mcp(input: McpInput): Promise<McpOutput>;
  readAuditEvents(): Promise<readonly AuditEvent[]>;
}
```

The adapter contract covers fixture creation, credential issuance, REST/MCP invocation, and audit inspection; the package owns the isolation and parity assertions. Optional capabilities are declared explicitly so a missing installed capability is skipped, while a declared capability with no fixture fails.

### 6.9 @codelitdev/platform-cli

    bunx @codelitdev/platform-cli create my-product
    bunx @codelitdev/platform-cli doctor
    bunx @codelitdev/platform-cli sync

The CLI:

- Instantiates the template and safely replaces declared tokens.
- Records capabilities and versions in .codelit-platform.json.
- Checks preset compatibility and required configuration.
- Re-renders managed files from the running CLI release with `sync`.
- Reports drifted managed files as conflicts for manual work.
- Does not edit product-owned paths just to match a current template.

Mutating `create` writes into a new empty directory through a temporary staging directory and renames it only after installation metadata validates. Mutating `sync` requires a Git repository with a clean worktree, records the starting platform manifest and managed-file hashes, computes the full plan before writing, and applies changes as one recoverable operation. It never commits or pushes.

A managed file may be replaced only when its current hash matches the hash recorded by the previous Platform operation. A mismatch is a conflict, not permission to overwrite. The CLI never changes a product-owned file; a release that requires product changes documents them (ADR 0006). On failure, the CLI restores all files it changed. `doctor` and every `--dry-run` command are read-only and work in a dirty repository.

## 7. Reference product and template

The completed reference product is the executable specification:

- apps/api: Express, ts-rest, OpenAPI, Better Auth, Drizzle/PostgreSQL, REST, MCP, Pino, optional PostHog, and worker entry point.
- apps/web: Next.js admin shell, BFF cookies, sign-in, tenant switcher, and one resource screen.
- packages/api-contract: shared Zod and ts-rest contract.
- Tenant, membership, invitation, API-key, audit-event, and example-resource models.
- Official @codelitdev/billing example with billing.config.ts, committed billing.generated.ts, application-owned Drizzle migration, createBilling composition, fake provider, action-grant adapter, audit/product-effect hooks, and worker maintenance entry point.
- PGlite integration tests and Docker Compose for PostgreSQL.

The example resource works through REST and MCP, denies cross-tenant access, and includes an explicitly authorized destructive mutation with an audit event.

After Phase 5, CI generates the template into a temporary directory, installs with a frozen lockfile, runs codelit-billing generate --check, migrates, tests, lints, type-checks, builds, and smoke-tests it.

### Managed and product-owned zones

.codelit-platform.json declares:

    {
      "schemaVersion": 2,
      "product": { "name": "Acme", "slug": "acme" },
      "cliVersion": "0.1.0",
      "capabilities": ["auth", "mcp", "observability", "billing"],
      "managedFiles": {
        ".github/workflows/platform-conformance.yml": "sha256:<digest>"
      },
      "productOwnedGlobs": ["apps/**", "packages/api-contract/**"]
    }

Managed files are enumerated and hashed rather than represented by broad replacement globs. The CLI can replace only an unchanged managed file. Product-owned changes are documented in release notes. `create` also writes a product-owned `code-quality.yml` workflow; `sync` never touches it.

## 8. Authentication and authorization

Admin auth follows FrontLit:

- Better Auth persists accounts and sessions in product PostgreSQL.
- oauth-server-kit provides OAuth provider behavior.
- Browser auth uses a same-origin BFF and HttpOnly Secure cookies.
- API and MCP accept configured OAuth tokens and tenant-scoped API keys.
- Product code checks membership on every request.
- Sensitive actions use recent auth and a single-use action token or equivalent grant.

### 8.1 Auth persistence and schema lifecycle

The reference product defines Better Auth configuration once in `apps/api`. Better Auth's supported schema generator produces a committed Drizzle schema artifact; the product runs drizzle-kit to generate, review, and apply SQL. @codelitdev/oauth-server-kit, package import, API startup, and worker startup run no DDL. CI regenerates the auth artifact and fails on drift.

Tenant memberships, invitations, API keys, audit events, and the selected-tenant preference are application tables because Better Auth authenticates principals but does not own product tenancy. Their migrations follow the same application-owned review and deployment lifecycle.

### 8.2 Credential precedence and tenant selection

The reference API accepts one credential mechanism per request:

1. A Better Auth session cookie forwarded by the same-origin BFF.
2. An OAuth access token in `Authorization: Bearer`.
3. A tenant-bound API key in `X-API-Key`.
4. An explicitly constructed internal `system` context that cannot be supplied over HTTP or MCP.

More than one supplied mechanism returns `credential_ambiguous`. An invalid explicit credential returns `unauthenticated`; the server never falls back to another credential or anonymous access. MCP accepts OAuth bearer or API key, not browser sessions.

The reference product uses `X-Tenant-ID` as an untrusted selector for tenant-scoped API and OAuth-authenticated MCP operations. The BFF may derive it from its route or selected-tenant preference. The resolver validates the public ID, loads current membership, and derives permissions on every request. Account-scoped endpoints reject a tenant selector unless their contract explicitly supports it; tenant-scoped endpoints return `tenant_required` when it is absent. An API key ignores any alternate selector and always resolves to its persisted tenant.

### 8.3 API keys

API keys contain a public lookup ID and at least 256 bits of random secret material. The secret is shown once. The database stores the public ID and an HMAC-SHA-256 digest using a separately configured pepper; comparison is constant-time. A key is bound to one tenant, a product-owned permission subset, creation actor, optional expiry, and revocation timestamp. Raw keys, digests, and peppers are never logged or emitted to telemetry.

Rotation creates a second key and requires explicit revocation of the old key, allowing a bounded overlap. Revocation takes effect on the next request. `lastUsedAt` is operational metadata and must not weaken authentication availability if its best-effort update fails.

### 8.4 Invitations

The reference invitation flow follows FrontLit's mechanism while remaining application-owned. An invitation binds one tenant, a normalized email address, inviter, product-owned role/permission assignment, expiry, and a single-use random token stored only as a digest. Acceptance requires an authenticated, verified email matching the invitation, current invitation validity, and a transaction that consumes the invitation and creates or updates membership exactly once.

Resending revokes the previous token. Revoking an invitation and removing a member are separate audited operations. Invitation acceptance cannot transfer tenant ownership or bypass the product's last-owner invariant.

Normalized trusted context:

    PlatformRequestContext<PrincipalId, TenantId, ProductPermission> {
      requestId
      principalId
      tenantId | null
      credential: { kind: session | oauth | api_key | system; credentialId? }
      permissions: ReadonlySet<ProductPermission>
    }

IDs and permissions remain product-owned. Separate identity realms remain separate; CourseLit learner identity does not share admin tables, sessions, or policy.

For billing actions, the Platform/application adapter converts that proof into @codelitdev/billing's consume-once BillingActionGrant bound to actor, action, target, issue time, and expiry. The billing engine still checks the persisted payer/customer/subscription association; an authorized tenant owner cannot use a fresh grant to impersonate another payer. Webhook and scheduled reconciliation use separate trusted system entry points.

## 9. API and MCP composition

Standard server order:

1. Correlation and safe logging.
2. Raw-body capture only on webhooks that require it.
3. Security headers, body limits, and rate limiting.
4. Authentication.
5. Tenant resolution and membership.
6. ts-rest adapter or MCP transport.
7. Product service and transaction.
8. Sanitized error capture.
9. Final error response.

Each product's api-contract package is the REST/OpenAPI source of truth. Route adapters stay thin. MCP reuses Zod only where the shape really matches.

An MCP parity manifest maps capabilities to REST operations and MCP tools. CI fails for missing required parity. Health, callbacks, webhooks, and transport-specific streaming may be exempted explicitly.

The manifest is committed beside the API contract and validates against a versioned schema:

```ts
type McpParityEntry =
  | {
      capability: string;
      risk: "read" | "write" | "destructive";
      rest: { operationId: string };
      mcp: { tool: string };
      parity: "required";
    }
  | {
      capability: string;
      rest?: { operationId: string };
      mcp?: { tool: string };
      parity: "exempt";
      exemption: {
        reason: string;
        owner: string;
        reviewBy: string;
      };
    };
```

Conformance verifies that referenced REST operations and MCP tools exist, call the same application service fixture, enforce equivalent authorization, and map stable errors consistently. `write` and `destructive` tools declare their risk in tool metadata. A destructive MCP operation additionally requires the same recent-auth/action-grant proof as REST or an explicit product-approved confirmation protocol; tool naming alone never authorizes execution. Expired exemptions fail CI until reviewed.

## 10. Billing and observability composition

Platform owns the source, release automation, reference integration, compatibility pins, and composition conformance for the official @codelitdev/billing package. Even inside the monorepo, the reference integration uses only its public subpaths:

- @codelitdev/billing/config for billing.config.ts and deterministic schema generation.
- @codelitdev/billing/drizzle for the product-database store.
- @codelitdev/billing/workflows for createBilling and the commercial-state engine.
- @codelitdev/billing/operations for authenticated operator recovery.
- @codelitdev/billing/providers and /providers/dodo for provider composition.
- @codelitdev/billing/testing for package-owned provider/workflow conformance.

The product checks in billing.generated.ts, runs codelit-billing generate --check in CI, and creates/reviews/applies SQL through its own drizzle-kit migration flow. Package install, import, API startup, and worker startup run no DDL.

Platform supplies reusable adapters and examples for Better Auth action grants, audit/observability ports, encryption, return-URL validation, graceful worker startup, and scheduled invocation of bounded maintenance batches. The product supplies the billable entity/payer mapping, offers, provider credentials, policy, product effects, HTTP contracts, UI, and operator authorization.

Other Platform packages and templates must not duplicate billing catalogs, checkout/customer state machines, provider adapters, webhook projection, reconciliation leases, commercial read models, lifecycle blockers, or operator services. Improvements to those mechanics are made in `packages/billing`, published as @codelitdev/billing, and reach products through a dependency upgrade plus any required generated-schema review.

Products own billable aggregates and commercial policy:

- SendLit: organisation billing, Cloud Free/Pro/Business, unlimited OSS.
- CourseLit: independently billed schools; cardless 14-day Cloud trial, then Pro/Business or public unavailability; unlimited OSS.
- CourseLit learner storefront checkout is unrelated and cannot use this integration.

There is no platform-wide plan enum. Product Free/OSS/cardless-trial state, capabilities, quotas, negotiated adjustments, grace, and availability do not enter the package's paid plan IDs.

Every application logs through Pino. PostHog is optional from the first commit and never affects readiness. Common fields use opaque public IDs. Product analytics is typed in the product and never replaces audit logs.

The observability package provides one process-scoped instance composed during application startup and passed to HTTP, MCP, webhook, and worker adapters. It does not export a preconfigured global singleton. Structured stdout remains active whether PostHog is absent, slow, misconfigured, or unavailable; remote exception and log delivery is additive.

Worker integrations translate framework callbacks into the generic API. The initial package may provide a small BullMQ adapter only after both SendLit and CourseLit Queue fixtures prove the same lifecycle contract; otherwise products retain thin listeners over `captureEvent` and `captureException`. Business/job event names and retry policy always remain product-owned.

## 11. Evolution and updates

The template is used once. Later changes flow through:

    platform change
      -> package and fixture tests
      -> reference product
      -> origin product canary
      -> Changesets release and migration guide
      -> compatible platform preset
      -> automated adopter PR
      -> adopter tests and conformance
      -> adopter canary and rollout

All @codelitdev packages release together under one version with Changesets (ADR 0006). A package change runs affected-package tests, reverse-dependency tests, packed-public-export tests, and the reference product before publishing. A compatibility change ships in the CLI's preset. Products never consume unpublished workspace source.

Each product repository pins resolved package versions in its lockfile. Dependabot groups `@codelitdev/*` Platform updates, opens a product-local PR, runs that product's integration and conformance suites, and leaves deployment observable and reversible. A semver range alone is not an update mechanism because an existing lockfile retains its prior resolution.

For a security fix, the affected package publishes a patch and the preset records both the recommended version and the minimum secure version. Automated adopter PRs are expedited; conformance or `platform-cli doctor` reports versions below the minimum secure release. Critical fixes may use coordinated disclosure and an emergency release path, but are never silently pushed into product repositories.

An extracted abstraction is not stable until its origin product consumes the published artifact. Billing has passed that origin-adoption gate: it is published and SendLit consumes its schema generator, Drizzle store, engine, operations, and public exports. Its pre-1.0 cross-product contracts still require CourseLit as the second-consumer proof before version 1 stabilization.

Future billing changes follow package tests -> billing reference consumer -> SendLit canary -> package release/migration guide -> compatible Platform preset -> adopter conformance and canary. A bootstrap template release is not required for an ordinary billing package upgrade.

OAuth, design-system, MCP, observability, and billing changes follow the same monorepo release discipline: edit the owning package, test affected dependants, publish that package, update the compatibility preset when necessary, and generate adopter PRs. Managed-file updates go through `platform-cli sync`, which never overwrites product-owned paths.

SemVer:

- Patch: behavior-preserving fix or diagnostic.
- Minor: additive API, opt-in capability, or managed-file change applied by `sync`.
- Major: removed contract, changed security meaning, or required product/migration work.

docs/compatibility.md records supported preset lines and end-of-support dates.

## 12. Delivery plan

### Phase 0 — Repository baseline and ADRs

Already complete:

- Normalize imported source into one private Bun workspace with one lockfile and no nested repositories.
- Establish Changesets, pinned CI, stable release automation, root verification, and packed-artifact checks.
- Lock the high-level package, product, persistence, billing, and update boundaries in this document.

Remaining:

- Preserve or intentionally archive the former billing, OAuth, and design-system repository histories, releases, issues, provenance, and security-reporting paths.
- Record ADRs for the kernel/auth contract, preset manifest, template ownership, release/support policy, and credential threat model.
- Complete the FrontLit, SendLit, MediaLit, and CourseLit Queue implementation inventory for auth, REST, MCP, tenancy, IDs, telemetry, worker lifecycle, tests, and deployment.
- Define package-level code ownership and the coordinated security-response rota.

Exit: repository history disposition is recorded, blocking ADRs are accepted, and every extraction names its source implementation and origin-product canary.

### Phase 1 — Kernel and reference application foundation

- Implement @codelitdev/platform's context, error, lifecycle, audit, ID, and safe transport-mapping contracts.
- Create `examples/reference-product/apps/api`, `apps/web`, and `packages/api-contract` without creating the distributable template yet.
- Implement Better Auth schema generation, OAuth composition, same-origin BFF sessions, tenant selection, memberships, invitations, API keys, audit events, and the credential-precedence rules in section 8.
- Add one tenant-owned example resource through ts-rest/OpenAPI and a Pino-stdout-only baseline.
- Integrate @codelitdev/billing through packed public exports, a committed generated schema, an application-owned migration, fake provider, action grants, audit/product-effect hooks, and bounded maintenance invocation.
- Add PGlite tests, Docker Compose PostgreSQL, migration drift checks, and public-API reports.

Exit: the reference web app signs in, creates/selects a tenant, performs an authorized and audited REST mutation, evaluates a billing entitlement, and denies cross-tenant access. No template or MCP claim is made yet.

### Phase 2 — Observability

- Characterize SendLit API's Pino/PostHog implementation and CourseLit Queue's PostHog, worker-event, and direct OTLP implementation.
- Implement @codelitdev/observability as an explicit factory, provider-neutral logging core, PostHog adapter, Pino/OTLP composition, bounded dedupe/rate limiting, and lifecycle controls.
- Integrate it into the reference application.
- Migrate SendLit first as the API/logging origin canary, then CourseLit Queue as the worker-process canary before stabilizing the public contract.
- Prove configured, absent, slow, failing, redacted, deduplicated, rate-bounded, double-capture-resistant, and timeout-bounded shutdown modes.

Exit: the packed package is consumed by the reference app and both origin canaries without product terminology or event catalogs entering the package.

### Phase 3 — MCP

- Compare the FrontLit, SendLit, and MediaLit MCP implementations and record the canonical source for each transport concern.
- Implement @codelitdev/mcp-server-kit transport, authentication hooks, sessions, context propagation, error mapping, cancellation, shutdown, and test harnesses.
- Integrate it into the reference application using the same example service as REST and the parity manifest in section 9.
- Migrate the selected origin product to the packed artifact before stabilizing the contract.

Exit: the reference resource has authorized REST/MCP parity, destructive-operation safeguards, and cross-tenant denial; the origin product consumes the published package.

### Phase 4 — Complete the reference specification, preset, and conformance

- Implement the compatibility preset with the versioned manifest from section 6.7 (now part of @codelitdev/platform-cli) and publish `docs/compatibility.md`.
- Implement @codelitdev/platform-conformance with the adapter contract from section 6.8.
- Run auth, tenant isolation, REST/OpenAPI, MCP parity, observability, billing composition, readiness, and shutdown suites against the reference product.
- Add affected/reverse-dependency CI and at least one registry-packed reference-product job.
- Configure grouped automated Platform update pull requests in origin/adopter repositories.

Exit: the reference product is the executable specification for one complete web -> REST/MCP -> service -> authorization -> persistence/audit -> telemetry/billing vertical.

### Phase 5 — Template and CLI

- Derive `templates/saas-product` from the proven reference composition, keeping product-owned seams explicit.
- Implement @codelitdev/platform-cli `create`, `doctor`, and `sync` with the transactional/hash rules in sections 6.9 and 7.
- Generate into a temporary clean directory in CI, install with a frozen lockfile, generate/check schemas, migrate, lint, type-check, test, build, and smoke-test.
- Exercise package updates and CLI `sync` against generated-repository fixtures; package updates must use packed registry artifacts, not workspace links.

Exit: one command creates a clean, independently owned product repository, and both package-only and source-changing updates are proven against generated fixtures through reviewable paths.

### Phase 6 — CourseLit

- Generate its new foundation only after the Phase 5 exit criteria pass.
- Replace the example tenant with schools and memberships.
- Adopt the published billing artifact as its second consumer with school/payer schema mapping, per-school subscriptions, no-Free Cloud policy, and product-owned 14-day trial/availability behavior.
- Before the production cutover, prove one ordinary package update, one minimum-secure patch update, and one managed-file `sync` against CourseLit's generated foundation through reviewable pull requests.
- Feed any genuinely shared workflow or hook improvements back into @codelitdev/billing, validate them in SendLit, and stabilize the proven contract rather than forking it in CourseLit.
- Keep products, learners, communities, sister-product integrations, and storefront checkout CourseLit-owned.

### Phase 7 — MediaLit and later products

- Adopt package by package instead of matching a template snapshot.
- Run conformance beside existing behavior before switching.
- Return reusable improvements through packages and `sync`.

## 13. Testing and security

Required tests:

- Unit and public-API type tests per package.
- Affected-package and reverse-dependency tests across the workspace.
- PGlite plus real PostgreSQL locking/migration coverage.
- OAuth browser and token flows.
- Better Auth generated-schema drift, with proof that auth package import and process startup perform no DDL.
- Tenant-isolation matrix across credential kinds.
- Ambiguous/invalid credential rejection with no fallback, and proof that an API key cannot select another tenant.
- API-key one-time display, digest verification, expiry, rotation overlap, immediate revocation, permission subsets, and log redaction.
- Invitation expiry, resend invalidation, email mismatch, consume-once concurrency, membership idempotency, auditing, and last-owner protection.
- ts-rest runtime/OpenAPI consistency.
- MCP session, auth, cancellation, and parity.
- PostHog absent/configured/failing, idempotent initialization, and timeout-bounded flush/shutdown.
- Exception redaction, product property allowlists, bounded dedupe state, per-source rate caps, and manual-versus-SDK double-capture prevention.
- HTTP and worker fixtures using opaque subject IDs, including failed/stalled job correlation without importing product tenant nouns into the package.
- Official billing package resolves through the preset and packed public exports only.
- Billing generated-schema drift and migration ownership.
- Fake-provider Cloud/OSS composition through product policy.
- Billing action-grant consumption plus persisted-payer enforcement.
- Required Cloud audit/product-effect hooks and bounded maintenance scheduling.
- Template generation and sync fixtures for supported presets.
- Preset manifest/lockfile compatibility, recommended-version, and minimum-secure-version fixtures.
- CLI empty-target, dirty-worktree, managed-hash conflict, sync idempotency, partial-failure rollback, and read-only dry-run fixtures.
- At least one CI consumer using packed public exports only.

Security requirements:

- Immutable package versions with provenance and SBOM.
- A machine-readable recommended/minimum-secure package manifest and adopter detection for vulnerable versions.
- Coordinated disclosure, patch publication, adopter PR, and emergency release runbooks.
- Pinned CI actions and critical dependencies.
- No logged secrets; encrypted persisted provider credentials.
- Threat models for tenant selection, auth, API keys, MCP, webhooks, and managed-file sync.
- Tenant escape and credential confusion are release blockers.
- Audit records remain separate from telemetry.

## 14. Version 1 definition of done

- One command bootstraps a clean directory.
- The reference vertical works through web, REST, and MCP.
- Every credential kind passes tenant-isolation conformance.
- Better Auth and billing schema generation are deterministic and application migrations remain application-owned.
- Credential precedence, API-key lifecycle, invitations, tenant selection, and last-owner invariants pass security conformance.
- OpenAPI comes from the runtime ts-rest contract.
- Optional PostHog is redacted, bounded, and failure-isolated.
- The reference app consumes the preset-pinned official billing package using public exports, a checked-in generated schema, and application-owned migration.
- Billing action grants, audit/product-effect hooks, fake-provider Cloud/OSS behavior, and maintenance invocation pass composition conformance.
- SendLit remains the billing origin-product canary; CourseLit proves the second-consumer contracts without copying SendLit billing code.
- Each extracted package has an origin-product consumer.
- Billing, OAuth, design-system, MCP, observability, and bootstrap packages build, test, version, and publish independently from one workspace.
- CourseLit can start without copying FrontLit or SendLit server code.
- One ordinary package update, one security patch, and one managed-file sync reach a real adopter through their documented paths.
- CLI conflict and rollback tests prove that a sync cannot silently overwrite managed drift or product-owned source.
- Compatibility and support policy is published.

## 15. Deferred decisions

- Whether outbox behavior becomes a package after another implementation.
- Whether the admin shell grows beyond design primitives.
- Whether deployment manifests are generated or examples.
- Whether Platform should provide a product-neutral scheduler lifecycle after CourseLit drip work. Billing-specific job state, claims, retry policy, and maintenance batches remain owned by @codelitdev/billing.

These require evidence from working consumers, not speculative generalization.
