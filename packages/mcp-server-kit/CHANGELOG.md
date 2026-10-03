# @codelitdev/mcp-server-kit

## 0.2.0

### Patch Changes

- 047058c: `selectHttpCredential` and `selectMcpCredential` now reject an `Authorization` header that is present but is not `Bearer <token>` with a new `{ kind: "malformed" }` selection (error code `unauthenticated`). Previously such a header was ignored, so a request could fall back to a session cookie or API key, contrary to ADR 0001. `Bearer <token> <extra>` is also malformed now. `mcp-server-kit` rejects malformed headers before calling `authenticate`.
  
  **Product changes**
  
  - Code that branches on the selection result must handle `"malformed"` like `"ambiguous"` (return a rejected result with `selected.error`). TypeScript reports the unhandled case where the code reads `selected.credential`.
- Updated dependencies [047058c]
  - @codelitdev/platform@0.2.0

## 0.1.0

### Patch Changes

- 894896a: Add MCP transport kit: sessions, CORS, OAuth/API-key hooks, tool risk, error mapping, and parity validation.
- Updated dependencies [894896a]
  - @codelitdev/platform@0.1.0
