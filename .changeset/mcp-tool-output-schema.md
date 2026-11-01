---
"@codelitdev/mcp-server-kit": minor
---

MCP tool definitions take an optional `title`, `outputSchema` (a Zod object schema) and `annotations` with `idempotentHint` and `openWorldHint`. `tools/list` advertises them, and the SDK checks a successful result's `structuredContent` against `outputSchema`. `risk` still sets `readOnlyHint` and `destructiveHint`. Tools without the new fields are unchanged.
