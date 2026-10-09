# @codelitdev/platform

Composition kernel for CodeLit products: request context, credential kinds,
safe errors, UUIDv7 / prefixed public IDs, health/readiness/shutdown, and
HTTP/MCP mapping conventions.

The package imports no product schema, reads no environment at import, and
performs no network I/O. Products implement authentication, tenant, and
authorization adapters.

See `docs/architecture.md` §6.4 and ADR 0001.

## Billing adapters

`@codelitdev/platform/billing` holds the adapters a product needs around
`@codelitdev/billing` (architecture §10, ADR 0013). Install
`@codelitdev/billing` to use it; the root export does not need it.

| Export | Use |
| --- | --- |
| `createBillingActionGrants` | Single-use action grants: `issue` a token after authenticating a recent session, `grant` to build the workflow input, and `authorization` as `createBilling({ authorization })`. |
| `createAesGcmSensitiveValues`, `aesGcmSensitiveValuesFromEnv` | AES-256-GCM for `createBilling({ sensitiveValues })`, with previous keys for rotation. |
| `createReturnUrlValidator` | Origin allowlist for `createBilling({ returnUrlValidator })`. |
| `startBillingWorkers` | Runs the maintenance batches on timers; `stop()` on shutdown. |
| `handleBillingWebhook`, `billingWebhookPath` | Verifies, stores, and acknowledges a provider webhook at `POST /webhooks/billing/<provider>`. |
| `billingErrorResponse` | Maps workflow errors to HTTP status and a stable code. |

`@codelitdev/platform/billing/drizzle` provides
`drizzleVerificationGrantStore(db, verification)`, which keeps grants in
Better Auth's `verification` table. It needs `drizzle-orm`.

```ts
const grants = createBillingActionGrants({
    store: drizzleVerificationGrantStore(db, verification),
});
const billing = createBilling({
    // ...
    authorization: grants.authorization,
    sensitiveValues: aesGcmSensitiveValuesFromEnv(),
    returnUrlValidator: createReturnUrlValidator([process.env.WEB_ORIGIN!]),
});
const workers = startBillingWorkers({ billing, workerId: `billing-${process.pid}` });
```
