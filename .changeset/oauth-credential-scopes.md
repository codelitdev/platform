---
"@codelitdev/platform": patch
---

`PlatformCredential` has an optional `scopes` field. Authentication adapters set it for `oauth` credentials so products can narrow permissions to the token's granted scopes (ADR 0008).
