# @codelitdev/platform

## 0.4.0

### Minor Changes

- 7b4a9ad: Add `@codelitdev/platform/billing` and `@codelitdev/platform/billing/drizzle` with the adapters products wrote themselves around `@codelitdev/billing` (ADR 0013): single-use action grants stored in Better Auth's `verification` table, AES-256-GCM encryption for stored billing values, a return-URL validator, a maintenance worker runner, a webhook handler for `POST /webhooks/billing/<provider>` (400 for a rejected signature or body, 503 when a verified webhook cannot be stored, so the provider retries), and HTTP mapping for billing errors. `@codelitdev/billing` and `drizzle-orm` are optional peer dependencies; the root export is unchanged.
  
  **Product changes for this release**
  
  - Replace a custom `BillingAuthorizationPort` with `createBillingActionGrants`. Issue a token from an authenticated route, send it with the billing request, and handle `recent_authentication_required`.
  - Replace custom encryption, return-URL checks, maintenance timers, webhook handlers, and billing error mapping with the matching adapters. Existing encrypted values stay readable.

### Patch Changes

- Updated dependencies [7b4a9ad]
- Updated dependencies [7b4a9ad]
- Updated dependencies [7b4a9ad]
- Updated dependencies [7b4a9ad]
- Updated dependencies [7b4a9ad]
- Updated dependencies [7b4a9ad]
  - @codelitdev/billing@0.4.0

## 0.3.0

### Patch Changes

- 8cbb124: `PlatformCredential` has an optional `scopes` field. Authentication adapters set it for `oauth` credentials so products can narrow permissions to the token's granted scopes (ADR 0008).

## 0.2.0

### Minor Changes

- 047058c: `selectHttpCredential` and `selectMcpCredential` now reject an `Authorization` header that is present but is not `Bearer <token>` with a new `{ kind: "malformed" }` selection (error code `unauthenticated`). Previously such a header was ignored, so a request could fall back to a session cookie or API key, contrary to ADR 0001. `Bearer <token> <extra>` is also malformed now. `mcp-server-kit` rejects malformed headers before calling `authenticate`.
  
  **Product changes**
  
  - Code that branches on the selection result must handle `"malformed"` like `"ambiguous"` (return a rejected result with `selected.error`). TypeScript reports the unhandled case where the code reads `selected.credential`.

## 0.1.0

### Patch Changes

- 894896a: Add the version-1 composition kernel: request context, credential kinds, safe errors, IDs, lifecycle, and HTTP/MCP mapping.
