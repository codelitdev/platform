# @codelitdev/oauth-server-kit

A lean Better Auth authentication library for CodeLit products. It provides
hosted login/consent pages, neutral session and OAuth identities, Express
bearer middleware, and MCP OAuth discovery.

The library authenticates people and OAuth clients. Each product continues to
own its users-to-actor mapping, organizations, teams, memberships, roles,
permissions, API keys, and credential precedence.

## Supported surfaces

- Web apps use product-local Better Auth sessions.
- Mobile apps use Authorization Code with S256 PKCE and a statically
  registered public client.
- REST APIs use OAuth bearer tokens through neutral `req.auth`.
- MCP servers use the same bearer verification plus RFC 9728 discovery and a
  standard `WWW-Authenticate` challenge.

Every product deploys its own Better Auth issuer, user store, sessions, OAuth
clients, signing keys, and provider configuration. The package is not a shared
CodeLit SSO service.

## Entry points

```ts
import {
    verifyOAuthAccessToken,
    type AuthenticatedIdentity,
} from "@codelitdev/oauth-server-kit";

import {
    createOAuthProviderOptions,
    resolveBetterAuthSession,
} from "@codelitdev/oauth-server-kit/better-auth";

import {
    createOAuthBearerMiddleware,
    createOAuthPagesRouter,
} from "@codelitdev/oauth-server-kit/express";

import { createMcpOAuthDiscoveryRoutes } from "@codelitdev/oauth-server-kit/mcp";
```

The root entry point does not load Express, a database library, or product
modules. Better Auth persistence and schema ownership remain in the consuming
application.

## Secure defaults

- OAuth Dynamic Client Registration is disabled unless explicitly enabled.
- Unauthenticated DCR requires a separate explicit opt-in.
- MCP client metadata documents (CIMD) are configured through the product's
  Better Auth plugins; see the integration guide for the secure fetch transport.
- Issuer and audience/resource are verified for every bearer token.
- Invalid explicit bearer tokens fail closed.
- Ordinary-login redirects are restricted to configured origins.
- Hosted pages reject framing and clear configured stale host-only cookies at
  both `/login` and `/oauth/login`.
- Product claims such as `team_id`, roles, or permissions are not returned as
  trusted package identity fields.

See [docs/integration.md](docs/integration.md) for full web, mobile, REST, and
MCP setup, and [docs/architecture.md](docs/architecture.md) for the normative
product requirements and public contract.

## Development gates

```bash
bun run check-types
bun test
bun run test:coverage
bun run build
```

The coverage release gate is 90% statements, lines, and functions and 80%
branches. The suite includes a real Better Auth OAuth Provider flow with a
public client, S256 PKCE, refresh, JWKS verification, and MCP discovery.
