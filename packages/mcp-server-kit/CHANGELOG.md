# @codelitdev/mcp-server-kit

## 0.5.0

### Minor Changes

- ffcabaa: Serve MCP 2026-07-28. The kit now runs on the official MCP TypeScript SDK 2 (`@modelcontextprotocol/server`) and is stateless: every request is authenticated, resolved to the product context, and handled by a fresh request-local server.
  
  - Modern clients get the 2026-07-28 protocol: `server/discover`, per-request protocol envelopes, `Mcp-Method`/`Mcp-Name` header validation, `resultType`, and cache hints on `tools/list` and `server/discover` (five minutes, private by default; set `catalogCacheHint` to change it).
  - 2025-era Streamable HTTP clients keep working through the SDK's stateless legacy mode. `initialize` no longer mints an `Mcp-Session-Id`; `GET` and `DELETE` answer `405`.
  - Tool results carry `structuredContent` plus one `text` copy. The invalid `{ type: "json" }` content item is gone; strict clients such as ChatGPT rejected every result carrying it and retried, duplicating writes.
  - Tool failures, including a destructive call without `confirm: true`, are tool results with `isError: true` and `structuredContent: { code, message, details }`, returned with HTTP 200. They were JSON-RPC errors with string codes, which JSON-RPC does not allow. Authentication and context failures before dispatch return the platform error body (`{ code, message }`) with its HTTP status.
  - Tool input schemas are advertised as JSON Schema without `$schema`, so clients read them under MCP's default dialect. Annotations follow the spec (`readOnlyHint`, `destructiveHint`); the risk stays in the tool's `_meta.risk`.
  - New options: `description`, `instructions`, `catalogCacheHint`.
  - Removed exports: `createMcpSessionStore`, `McpSession`, `McpSessionStore`, `StreamableHTTPServerTransport`, `WebStandardStreamableHTTPServerTransport`, and the kit's `sessions` property.
  
  `platform-conformance` reads MCP tool failures from `isError` tool results.

### Patch Changes

- @codelitdev/platform@0.5.0

## 0.4.2

### Patch Changes

- @codelitdev/platform@0.4.2

## 0.4.1

### Patch Changes

- Updated dependencies [b04e522]
  - @codelitdev/platform@0.4.1

## 0.4.0

### Patch Changes

- Updated dependencies [7b4a9ad]
  - @codelitdev/platform@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [8cbb124]
  - @codelitdev/platform@0.3.0

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
