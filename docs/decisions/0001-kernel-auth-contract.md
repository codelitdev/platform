# ADR 0001: Kernel and authentication contract

Status: accepted  
Date: 2026-09-02

## Context

Products need a shared, transport-neutral request context and error
vocabulary without inheriting a product schema, tenant noun, or permission
taxonomy. FrontLit, SendLit, and MediaLit already implement overlapping
auth, but each owns tenancy and persistence.

## Decision

`@codelitdev/platform` ships the version-1 kernel in architecture §6.4:

- `CredentialKind` is exactly `session | oauth | api_key | system`.
- `PlatformRequestContext` carries `requestId`, `principalId`, `tenantId`
  (nullable), `credential`, and a `ReadonlySet` of product-owned
  permissions.
- Authentication adapters establish credential validity and principal
  identity only. Tenant adapters load current membership and permissions
  for every tenant-scoped operation.
- HTTP and MCP adapters never return a `system` credential. System
  contexts are constructed only by trusted in-process entry points.
- `absent` is allowed only on an explicitly public route. Protected HTTP
  and MCP adapters map `absent` to `unauthenticated`.
- `rejected` covers invalid, expired, malformed, or ambiguous credentials
  and must never fall back to another mechanism.
- `PlatformErrorCode` is the complete version-1 vocabulary. `message` is a
  stable public-safe string selected by code path and is never derived
  from `cause`. Thrown exceptions map to `internal_error` after sanitized
  capture.
- The kernel imports no product schema, reads no environment at import,
  and performs no network I/O.

## Consequences

- Products implement adapters; the kernel stays a small composition
  surface.
- A public seam is not considered proven until the reference app and at
  least one real product consume it.
- MCP, observability, and templates must reuse this contract rather than
  invent parallel error or credential types.
