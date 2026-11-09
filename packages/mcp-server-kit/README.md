# @codelitdev/mcp-server-kit

A stateless MCP endpoint for CodeLit products, built on the official MCP
TypeScript SDK 2. It serves protocol `2026-07-28` and, through the SDK's
stateless legacy mode, 2025-era Streamable HTTP clients from one handler.

The kit owns protocol compliance: OAuth/API-key authentication over
`@codelitdev/platform` credentials, CORS, tool annotations and risk metadata,
spec-shaped tool results and errors, cancellation, shutdown, and
parity-manifest validation. Products own tool names, Zod schemas,
authorization, and service calls.

Every request is authenticated and resolved to a product context before a
fresh, request-local server handles it; there are no MCP sessions.
