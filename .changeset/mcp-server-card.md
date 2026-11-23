---
"@codelitdev/mcp-server-kit": minor
"@codelitdev/platform-conformance": minor
---

MCP Server Card and AI Catalog discovery. `createMcpServerKit` takes an optional `serverCard` config and exposes `serverCard` and `handleServerCard()` for `GET <endpoint>/server-card`. `createAiCatalogHandler()` serves `/.well-known/ai-catalog.json`. Both are public and cacheable. `platform-conformance` adds `runMcpServerCardConformance` to check the card and catalog over a product's real HTTP stack.
