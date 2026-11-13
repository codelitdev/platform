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
    isRecentlyAuthenticated,
    resolveBetterAuthSession,
    secureCookieOptions,
    secureEmailAndPasswordOptions,
    secureSessionOptions,
    sessionCookieName,
} from "@codelitdev/oauth-server-kit/better-auth";

import {
    createClientIpMiddleware,
    createOAuthBearerMiddleware,
    createOAuthPagesRouter,
    parseTrustProxy,
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
- Session cookies are `__Host-<prefix>.session_token` (Secure, `Path=/`, no
  `Domain`) over https through `secureCookieOptions`; with cross-subdomain
  cookies they stay `__Secure-`, and over http (local dev) they are plain.
  Products keep their own `cookiePrefix` and pass it to the helper.
- `secureSessionOptions()` turns the session cookie cache off, so a revoked
  session stops working on the next request.
- `secureEmailAndPasswordOptions()` keeps password sign-up off; a product
  that opts in with `{ enabled: true }` also requires a verified email before
  sign-in, so nobody can claim an address they don't own.
- `createClientIpMiddleware` resolves the client address from a trusted proxy
  chain (`req.ip`, which ignores the attacker-controlled left of
  `X-Forwarded-For`) into an internal header, and `secureCookieOptions`'
  `clientIpHeader` makes Better Auth read only that header.
- Session identities carry `authenticatedAt`; `isRecentlyAuthenticated`
  supports step-up checks. OAuth identities never count as recent.
- Product claims such as `team_id`, roles, or permissions are not returned as
  trusted package identity fields.

Known limitation: `@better-auth/oauth-provider`'s RP-initiated logout
confirmation cookie (`<session cookie>.oauth_logout_confirmation`) is set on
`/api/auth/oauth2/end-session/confirm`. Browsers reject a `__Host-` cookie with a
path other than `/`, so under `__Host-` that confirmation step (shown when an
OAuth client calls end-session without a valid `id_token_hint`) cannot complete.
Neither the plugin options nor `advanced.cookies` can change that cookie's name
or path. Use cross-subdomain mode (`__Secure-`) if a product needs the flow.
See [ADR 0018](../../docs/decisions/0018-secure-session-cookies-and-client-ip.md).

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
