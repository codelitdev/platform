---
"@codelitdev/platform-cli": patch
"@codelitdev/mcp-server-kit": patch
---

Raise the `next` pin to 16.4.1 (critical RCE fixes) and the `@modelcontextprotocol/sdk` pin to 1.32.1. `doctor` now treats external pins as caret floors, so products can take later patch and minor releases (including security fixes) without failing conformance.
