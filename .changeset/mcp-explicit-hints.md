---
"@codelitdev/mcp-server-kit": minor
---

Every tool now advertises all four annotation hints as explicit booleans: `readOnlyHint` and `destructiveHint` from its `risk`, and `idempotentHint` and `openWorldHint` from `annotations`, defaulting to `false`. The ChatGPT Plugins Directory requires `readOnlyHint`, `destructiveHint` and `openWorldHint` to be set explicitly on every tool. Read tools used to leave `destructiveHint` out, and tools without `annotations` left out the other two.

### Product changes

A tool that reaches outside the tenant's own workspace (sends email, posts to arbitrary destinations, searches the public web) should now pass `annotations: { openWorldHint: true }`; without it the kit advertises `false`.
