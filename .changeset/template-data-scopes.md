---
"@codelitdev/platform-cli": minor
---

The template enforces OAuth data scopes (ADR 0008). It adds a `data:write` scope, advertises `data:read`, `data:write`, and `offline_access` to MCP clients, carries a token's scopes on its OAuth credential, and narrows tenant permissions to what those scopes allow. Previously a token approved as `data:read` received every permission of the member's role.

**Product changes for this release**

- Add `data:write` to the OAuth provider's `scopes` and `clientRegistrationAllowedScopes`, and advertise `["data:read", "data:write", "offline_access"]` in `createMcpOAuthDiscoveryRoutes`.
- Set `scopes: resolved.identity.scopes` on the OAuth credential, and keep only the permissions those scopes cover. Reads belong to `data:read`; anything that creates, changes, or deletes belongs to `data:write`.
- Existing OAuth tokens carry only `data:read`. Users re-authorize their MCP clients once to regain write access.
