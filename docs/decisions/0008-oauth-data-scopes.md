# ADR 0008: OAuth data scopes

Status: accepted  
Date: 2026-10-04

## Context

The template advertised one resource scope, `data:read`, and never checked
it. An OAuth request received every permission of the member's role, so a
token the user approved on the consent screen as `data:read` could create,
change, and delete data. MediaLit, which copied the template, showed the
same consent screen for a token that could upload and delete media.

MCP clients request exactly the scopes listed in the protected-resource
metadata's `scopes_supported`. With only `data:read` listed, they never
requested `offline_access`, received no refresh token, and sent the user
back to the consent screen whenever the access token expired.

## Decision

- Products define two resource scopes: `data:read` and `data:write`. The
  OAuth provider supports both, and dynamic client registration may request
  both.
- The MCP protected-resource metadata advertises `data:read`, `data:write`,
  and `offline_access`.
- `PlatformCredential` has an optional `scopes` field. Authentication
  adapters set it for `oauth` credentials from the verified token.
- An OAuth request keeps only the permissions that its granted scopes cover.
  The template maps scopes to permissions in `SCOPE_PERMISSIONS` and narrows
  tenant permissions in `resolveTenantContext`. Each product maps its own
  permissions; reads belong to `data:read`, and anything that creates,
  changes, or deletes belongs to `data:write`.
- Sessions and API keys are not narrowed. Their permissions come from the
  member's role or the key.

## Consequences

- The consent screen now matches what a token can do, and a client that
  requests only `data:read` cannot write.
- Tokens issued before this change carry only `data:read` and lose write
  access. Users re-authorize their MCP clients once.
- A new permission must be added to `SCOPE_PERMISSIONS`; otherwise OAuth
  requests never receive it.
- Products that check scopes outside tenant resolution, such as MediaLit's
  per-tool MCP checks, follow the same rule: read-only operations need
  `data:read` and all others need `data:write`.
