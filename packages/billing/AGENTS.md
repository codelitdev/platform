# Agent notes — @codelitdev/billing

This is a **library**, not an app. It ships hexagonal billing mechanics for CodeLit products. First consumer is SendLit (`/home/rajat/dev/proj/sendlit`). CourseLit is not a consumer yet. Workflows are **experimental**; npm version is **0.1.0-alpha.x** (tag `alpha`) until a real two-consumer + canary cutover. Do not publish `latest` or `1.0.0` unless the human asks.

Human owns git push.

## Commands

```bash
bun install
bun test           # Bun test; PGlite files run sequentially
bun run typecheck
bun run lint
bun run build      # tsc → dist/; consumers import dist, not src
bun run test:packed # tarball + public exports only
```

CLI (after build, or via `bun run generate`):

```bash
bun x codelit-billing generate --config <billing.config.ts>
bun x codelit-billing generate --check --config <billing.config.ts>
```

Do not add `console.log` (Biome's console rule, `warn`/`error` allowed). Do not import `src/` from a consumer or from `package.json` `exports`.

## Layout

| Path | Owns |
| --- | --- |
| `src/core/` | Types, money, transitions, projection diff, clock, errors. No SDK/ORM/HTTP. |
| `src/catalog/` | Offer validation, revision rules, public catalog (no provider IDs). |
| `src/schema/` | Canonical model + TS generator. |
| `src/cli/` | `generate` / `--check` only. No migrate command. |
| `src/adapters/drizzle/` | Store, `withTransaction`, `getTransaction()`, `noteProviderCall`. Only place that imports drizzle-orm. |
| `src/providers/` | Contract, registry, fake, Dodo. Dodo must not read `process.env` or emit `sendlit*` metadata. |
| `src/workflows/engine.ts` | All cross-boundary workflows in one module (`createBilling`). Experimental. |
| `src/operations/` | Operator inspect/retry/reconcile/cancel/decrypt. Requires `OperatorContext`. |
| `src/ports/` | Audit, authorization grant, lifecycle hooks, sensitive values, telemetry. |
| `src/testing/` | Provider contract suite + workflow harness. |
| `src/maintenance/` | Retry policy, health facts, batch helpers. |
| `examples/` | Reference + SendLit/CourseLit **config mapping** fixtures, not live products. |
| `docs/` | `architecture.md` (proposed v1 spec), `runbooks.md`, `decisions/0001-*.md`. |

Public subpaths are listed in `package.json` `exports` and asserted by `src/exports.test.ts`. Adding an export means `package.json` + `exports.test.ts` + `bun run build`.

## Invariants — do not break

1. **No DDL** on install, import, `createBilling`, or worker start. Generate TypeScript; the **application** runs drizzle-kit and applies SQL.
2. **No `process.env` in adapters/core.** The app parses env and passes typed options (`createDodoBillingProvider({ apiKey, environment, webhookSecrets, clock })`).
3. **Injected `Clock`.** Decision code and adapters take `clock.now()`. Do not sprinkle `new Date()` / `Date.now()` into core/workflow time boundaries. (Hooks/apps may still use wall time for their own columns.)
4. **No transaction across a provider call.** `noteProviderCall()` throws `transaction_open_across_provider_call` if ALS still has a tx. Prepare (commit) → HTTP → finalize (new tx).
5. **Webhook envelope ≠ entitlement.** `ingestWebhook` verifies and inserts; the worker `retrieveSubscription` then `projectSnapshot`. `payment.succeeded` with no subscription id is ignored.
6. **Equivalent snapshots are freshness-only.** Material fields bump `projectionVersion` once and fire one audit/effect. Do not increment on every retrieve.
7. **Payer is persisted, not “whoever holds a grant.”** Grants are consume-once authorization freshness. Workflows still compare stored payer on customer/attempt/subscription.
8. **Cloud composition:** audit hook + `returnUrlValidator` + `checkoutProvider` + `requestedRevision` + exact `offers`/`requiredOfferKeys`. OSS forbids providers, offers, and revision.
9. **Canonical `billing_plan_states` is narrow:** `billableEntityId`, nullable `activeSubscriptionId`, `projectionVersion`. Free/trial/ramp/overrides are `additionalFields` or other app tables. Never put `"free"` in `planIds`.
10. **Opaque additional fields.** Generator may emit extra columns; workflows must not assign product meaning to them. Use `checkoutApplicationFields` codec for attempt extras (e.g. `pendingTeamName`).
11. **Stable errors only.** Persist `BillingWorkflowError.code` or `provider_${code}`. Never persist SDK bodies. Raw `Error.message` is currently collapsed to `provider_error` in the webhook inbox — do not make that worse; prefer mapping known errors.
12. **Catalog monotonicity.** An older instance cannot activate a lower revision over a newer active catalog. Pending/invalid requested revision freezes **checkout only**.

If a change violates one of these, add or extend a characterization test in the same PR. Default is SendLit behavioral compatibility unless `docs/decisions/0001-extraction-discrepancies.md` names a correctness defect (today: equivalent-snapshot no-op).

## Schema generator vs consumer SQL

Agent-confused this more than anything else:

1. Edit `src/schema/` (canonical columns/indexes) and/or consumer `billing.config.ts`.
2. `codelit-billing generate` writes `billing.generated.ts` (committed, never hand-edited).
3. **Consumer** runs `drizzle-kit generate` then `drizzle-kit migrate`.
4. Package CI uses PGlite + `examples/reference-product` rehearsals. It does not migrate SendLit prod.

`additionalFields` cannot shadow reserved canonical names. `tableNames` maps to existing `billing_*` tables so SendLit does not get a parallel schema. When generating SQL in a consumer repo, set `CI=true` if drizzle-kit would otherwise prompt a destructive rename.

Bump `PACKAGE_SCHEMA_VERSION` in `src/config/validate.ts` when generated output meaning changes. Keep npm on the `0.1.0-alpha.x` line unless the human asks otherwise.

## Workflows and product hooks

`createBilling` lives in `src/workflows/engine.ts`. Prefer extending that engine and the ports over inventing a second orchestrator.

Lifecycle `afterProjection` runs **inside** `store.withTransaction`. Consumers must:

```ts
afterProjection: (input) =>
  applyProductEffects(input, store.getTransaction() ?? db)
```

If `tx === db`, the app may open `db.transaction`. If `tx` is the engine client, write on `tx` — a nested `db.transaction()` on the root pool **deadlocks** on `FOR UPDATE` (SendLit first Dodo cycle).

`getTransaction()` is part of the Drizzle store public surface (`DrizzleBillingStore`). Keep it.

Audit hooks should use the same open client when they write. Network/email belongs after commit (outbox), not in the projection transaction.

## Providers

- Fake: deterministic success/delay/duplicate/out-of-order/bad-signature/outage. Seed catalog in tests; do not bake SendLit env names into the fake.
- Dodo: `src/providers/dodo/`. Metadata allowlist is `checkoutAttemptId` and `catalogKey` only. `no-env.test.ts` will fail if `process.env` or `sendlit` appears.
- Every adapter must pass `runBillingProviderContract` from `@codelitdev/billing/testing`, including side-effect-then-timeout recovery matching declared `mutationRecovery`.
- Sandbox tests (`sandbox.test.ts`) stay `describe.skipIf` unless `BILLING_DODO_SANDBOX_*` is set. Never commit keys. Never print them.

## Consumers

This repo does not deploy SendLit. When a package change needs a consumer:

- SendLit engine: `apps/api/src/billing/engine.ts`
- SendLit effects: `apps/api/src/billing/product-effects.ts`
- SendLit generated schema: `apps/api/src/db/billing.generated.ts` (regenerate, don’t edit)
- SendLit consumes the published package. Test a local candidate through a packed tarball or a Changesets snapshot; do not make the product depend on Platform workspace source.

Do not “fix OTP” or auth in SendLit to make billing smoke easier. Do not leak `.env` secrets in logs or README samples with real values.

CourseLit mapping under `examples/consumers/courselit/` is a **generator fixture** (no Free in `planIds`). Do not treat it as a live integration.

## Tests

- Bun test, sequential PGlite files, and 60s timeouts (PGlite WASM).
- Isolation: `src/core/isolation.test.ts` forbids core importing drizzle/dodo/express/pino/posthog.
- Prefer table-driven transition tests and the workflow harness over spinning Express.
- Real PostgreSQL lock tests are **not** in CI yet; do not claim they are. PGlite covers generator/adapter happy paths.
- After engine/store/export changes run `bun test` and `bun run build`. After `package.json` exports changes run `bun run test:packed`.

## Docs

- `README.md` — purpose and consumer how-to. Update when public compose/CLI steps change.
- `docs/architecture.md` — proposed v1. It is **ahead** of the repo (no Changesets, no adoption.md, no property tests, no live CourseLit). Do not implement FrontLit/MediaLit or “v1 DoD” unless asked.
- `docs/runbooks.md` — operator units over `createOperations`. Product CLIs wrap these; the package is not an unauthenticated CLI for retry/cancel.
- New architecture discrepancies go in `docs/decisions/`, not as silent SendLit forks.

## Typical change map

| You changed | Also |
| --- | --- |
| Canonical column/index | generator + reference `billing.generated.ts` rehearsal + schema tests |
| `createBilling` options | engine composition errors, README, SendLit `engine.ts` |
| Snapshot fields / diff | `projection-diff` tests + webhook harness |
| Dodo mapping | `normalize.ts` tests + no-env test + contract suite |
| Retry/lease policy | `src/maintenance/retry.ts` + webhook/reconciliation tests |
| Public export | `package.json`, `exports.test.ts`, `bun run build` |

## Out of scope unless the human asks

Metering/quotas, tax, invoices, provider-to-provider subscription migration, a migrate CLI, splitting provider packages, bumping to 1.0.0, CourseLit product integration, git push.
