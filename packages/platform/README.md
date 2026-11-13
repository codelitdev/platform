# @codelitdev/platform

Composition kernel for CodeLit products: request context, credential kinds,
safe errors, UUIDv7 / prefixed public IDs, health/readiness/shutdown, and
HTTP/MCP mapping conventions.

The package imports no product schema, reads no environment at import, and
performs no network I/O unless a product calls the DNS helpers below. Products implement authentication, tenant, and
authorization adapters.

See `docs/architecture.md` §6.4 and ADR 0001.

## Domain verification

Custom-domain checks shared by every product (root export). No storage, no
environment reads, no product rules: apps keep their own apex/`www` pairing or
one-domain-per-tenant policy.

```ts
import {
  createDnsResolver,
  createDomainVerification,
  issueOwnershipToken,
  normalizeHostname,
} from "@codelitdev/platform";

const hostname = normalizeHostname(userInput); // null when invalid
const token = issueOwnershipToken(); // 16 random bytes, hex
const domains = createDomainVerification({
  label: "_myproduct-verification",
  resolver: createDnsResolver({ servers: ["1.1.1.1", "8.8.8.8"] }),
});

domains.ownershipRecord(hostname, token); // { type: "TXT", name, value: token }
await domains.verifyOwnership(hostname, token);
await domains.verifyRouting(hostname, {
  cnameTarget: "edge.example.net",
  aRecords: ["203.0.113.10"], // optional, apex only
});
```

| Export | Use |
| --- | --- |
| `normalizeHostname(input, { allowIpLiteral?, allowPublicSuffix? })` | Lowercase, punycode, no trailing dot; null for ports, paths, credentials, bad labels, single-label names, IP literals and public suffixes (`com`, `co.uk`, `github.io`) unless allowed. |
| `isApexHostname(hostname)` | True when the host is its registrable domain (`example.co.uk` yes, `www.example.co.uk` no). Uses the public suffix list including its private section. |
| `issueOwnershipToken()` | 16 random bytes, hex. |
| `createDnsResolver({ servers?, timeoutMs? })` | `node:dns` resolver; `servers` pins trusted recursive resolvers, every lookup times out (default 5000 ms). Inject any `DnsResolver` in tests. |
| `createDomainVerification({ label, resolver? })` | `ownershipRecord`, `verifyOwnership` (TXT at `<label>.<host>`, chunks joined, exact match), `verifyRouting` (CNAME chain with loop protection; an apex may use CNAME flattening, or A records that must equal `aRecords` when given). DNS errors and timeouts are `false`. |

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
