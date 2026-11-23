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

## Discovery: Server Card and AI Catalog

Pass `serverCard` to publish an [MCP Server Card](https://modelcontextprotocol.io/seps/2127-mcp-server-cards)
so clients can set the server up from a URL. The kit builds the card once,
fails at startup on a value the card schema rejects, and serves it with the
CORS, `Cache-Control`, and `ETag` headers the
[discovery doc](https://github.com/modelcontextprotocol/ext-server-card/blob/main/docs/discovery.md)
asks for.

```ts
import { AI_CATALOG_PATH, createAiCatalogHandler, createMcpServerKit } from "@codelitdev/mcp-server-kit";

const mcp = createMcpServerKit({
  name: "medialit",
  version,
  description: "Upload, transform and serve media files.",
  serverCard: {
    name: "dev.codelit/medialit", // reverse-DNS namespace / name
    title: "MediaLit",
    endpoint: "https://api.medialit.cloud/mcp",
    websiteUrl: "https://docs.medialit.cloud/mcp",
    protectedResourceMetadataUrl:
      "https://api.medialit.cloud/.well-known/oauth-protected-resource/mcp",
  },
  // ...authenticate, resolveContext, tools
});
const aiCatalog = createAiCatalogHandler([mcp.serverCard!]);

// Both are public. Route them before authentication.
// GET /mcp/server-card            -> mcp.handleServerCard({ method, headers })
// GET /.well-known/ai-catalog.json -> aiCatalog({ method, headers })
```

The card states who operates the server: its name is in the `dev.codelit`
namespace and `_meta["dev.codelit/provider"]` names CodeLit. It does not list
tools, and protocol versions and capabilities are still negotiated through
`server/discover`. Keep tool descriptions static so the live catalog cannot
drift from what the card's operator published. Check both documents with
`runMcpServerCardConformance` from `@codelitdev/platform-conformance`.
