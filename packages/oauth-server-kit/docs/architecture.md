# PRD: Lean OAuth Authentication Kit

**Package:** `@codelitdev/oauth-server-kit`  
**Status:** Phase 1 implemented; release gates passing  
**Primary consumers:** SendLit, FrontLit, and MediaLit  
**Scope:** Authentication for web apps, mobile apps, REST APIs, and MCP servers

## Executive summary

`oauth-server-kit` is a small, reusable authentication library built on Better
Auth and `@better-auth/oauth-provider`. A product embeds it in its own API to:

- host user login and OAuth consent;
- issue OAuth access and refresh tokens;
- validate a Better Auth browser session;
- validate an OAuth bearer token presented to a REST API or MCP server; and
- publish the OAuth discovery metadata required by OAuth and MCP clients.

The package authenticates a person and returns a neutral identity. It stops at
that boundary.

It does **not** know what a SendLit organization, FrontLit team, MediaLit API
key, role, permission, quota, workspace, or product account is. Those are
application authorization and business-domain concerns. They remain in the
application that owns them.

The package is a reusable library, not a new centralized identity service.
Each product deploys its own Better Auth instance, retains its own users and
sessions, chooses its own database adapter, and mounts the kit's routes and
middleware. Reusing the kit therefore does not automatically create single
sign-on or a shared user database between products.

The minimum architecture is:

```text
Browser session cookie ─┐
                        ├─ oauth-server-kit ─> AuthenticatedIdentity
OAuth bearer token ─────┘                              │
                                                      v
                                         Product-owned auth resolver
                                                      │
                                      actor + tenant + permissions
```

## Implementation status

Phase 1 is implemented in `0.1.0`:

- the package exposes only the frozen root, `/better-auth`, `/express`, and
  `/mcp` contracts;
- product accounts, API keys, teams, membership checks, and team selection
  have been removed from the package;
- FrontLit owns and tests its account, API-key, team-selection, membership,
  request-projection, and Better Auth persistence code;
- the package includes real Better Auth Authorization Code, S256 PKCE,
  refresh, session revocation, DCR opt-in, JWKS verification, and discovery
  integration tests; and
- web, mobile, REST/ts-rest, and MCP integration is documented in
  `docs/integration.md`.

The package test/coverage, typecheck, and build commands and FrontLit's API
test, typecheck, and build commands are release gates. SendLit and MediaLit
adoption remain Phase 2 and Phase 3 respectively; their adoption is not part
of the Phase 1 package boundary.

## Product decision

The package owns **authentication**:

- Who is the user?
- Is the Better Auth session valid?
- Is the OAuth access token authentic, unexpired, issued by the expected
  issuer, and intended for the expected resource?
- Which OAuth client requested the token?
- Which scopes were granted in the token?
- How can a client discover and complete the OAuth flow?

Each product owns **authorization and product credentials**:

- Does this authenticated user have a SendLit application user record?
- Which SendLit organizations and teams can that user access?
- Which FrontLit team is active?
- Does a MediaLit API key or upload signature authenticate a request?
- Does the user have the required role or permission?
- Does a team have a feature, entitlement, or quota?
- Which product resource may be read or changed?

OAuth scopes are carried and returned by the kit because they are part of the
OAuth credential. The product declares the scopes and decides what each scope
allows. The kit must not translate a scope into a product role or permission.

## Problem

SendLit, FrontLit, and MediaLit expose the same four kinds of protected
surfaces:

- a browser-based web application;
- a mobile application or other public native client;
- a REST API; and
- an MCP server.

Without a shared package, each application repeats security-sensitive OAuth
work: login and consent pages, callback handling, session-cookie behavior,
token verification, OAuth discovery, MCP challenges, redirect validation, and
error semantics. The implementations drift and fixes must be rediscovered in
each product.

The earlier package direction tried to also centralize product accounts, API
keys, teams, team selection, membership validation, and Express request
projection. That made the package FrontLit-shaped and prevented it from being a
small authentication primitive usable by SendLit and MediaLit.

The desired package must centralize the protocol and login boundary while
remaining unaware of every product's domain model.

## Goals

### Phase 1 goals

- Provide one well-tested Better Auth OAuth 2.1 setup pattern for all products.
- Provide hosted login and consent pages suitable for browser, mobile, and MCP
  authorization flows.
- Resolve a valid Better Auth browser session to a neutral authenticated
  identity.
- Verify OAuth access tokens and return the same neutral identity shape.
- Protect Express REST routes with a thin bearer-authentication middleware.
- Publish OAuth, OIDC, and MCP protected-resource discovery endpoints.
- Return standards-compatible `401` responses and `WWW-Authenticate`
  challenges.
- Support Authorization Code with S256 PKCE for public clients, including
  mobile and MCP clients.
- Keep framework and database dependencies out of code paths that do not need
  them.
- Let SendLit, FrontLit, and MediaLit integrate without changing their product
  tenancy or permission models.

### Later goals

- Add another HTTP-framework adapter only after a real consumer needs one.
- Add common branding slots if the three products cannot use the same minimal
  hosted screens.
- Allow each product to add its own enterprise OIDC or SAML login through
  Better Auth's SSO plugin without introducing product tenancy into the kit.
- Add operational helpers for signing-key rotation after the deployment model
  is proven.

## Non-goals

The following are explicitly outside this package:

- a shared CodeLit user database, cross-product login session, or
  organization-wide SSO service;
- application user, account, organization, team, workspace, membership, role,
  permission, entitlement, or quota models;
- selecting an active organization, team, or workspace;
- product API keys, organization keys, team keys, upload keys, or webhook
  signatures;
- product-specific access-token claims such as `team_id` or
  `organization_id`;
- authorization policies for REST endpoints, MCP tools, or web pages;
- a generic credential-precedence engine combining OAuth, sessions, and
  product API keys;
- a ts-rest adapter;
- a mobile client SDK;
- email delivery infrastructure for OTP messages;
- social-provider credentials;
- forcing consumers to use PostgreSQL, Drizzle, MongoDB, or any other storage
  technology;
- service-to-service `client_credentials` flows in Phase 1; and
- replacing Better Auth's maintained OAuth and session implementation with
  custom protocol code.

Products may continue to support their own API keys or signed requests. Such a
product credential is resolved by product middleware and must not be passed to
or interpreted by `oauth-server-kit`.

## Consumers and surfaces

| Consumer | Web app                            | Mobile app                   | REST API                                         | MCP server                                | Product logic that stays local                                                         |
| -------- | ---------------------------------- | ---------------------------- | ------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| SendLit  | Better Auth session                | OAuth + PKCE when introduced | OAuth bearer plus SendLit-owned keys             | OAuth bearer plus any SendLit-owned keys  | users, organizations, teams, memberships, organization keys, team keys, grants, quotas |
| FrontLit | Better Auth session                | OAuth + PKCE when introduced | OAuth bearer plus FrontLit-owned keys            | OAuth bearer plus any FrontLit-owned keys | accounts, teams, memberships, API keys, permissions                                    |
| MediaLit | Better Auth session after adoption | OAuth + PKCE when introduced | OAuth bearer plus MediaLit-owned keys/signatures | OAuth bearer plus any MediaLit-owned keys | users, media tenancy, API keys, upload signatures, permissions                         |

ts-rest does not alter this design. In the current applications, ts-rest runs
inside the HTTP server after Express middleware. Authentication happens before
the contract handler. A ts-rest contract may document `401` and `403`
responses and OpenAPI bearer security, but it does not need a package-specific
runtime adapter.

## Terminology

### Authentication

Establishing the identity associated with a valid Better Auth session or OAuth
access token.

### Authorization

Deciding whether an authenticated identity may perform a product action.
Authorization belongs to the consuming application.

### Authorization server

The Better Auth OAuth Provider deployment that logs in a user, records consent,
and issues OAuth tokens. Every consuming product hosts its own independent
authorization server. Cross-product SSO is not a planned capability.

### Resource server

A REST API or MCP server that accepts an OAuth bearer token for a configured
resource/audience and verifies it through the kit.

### Browser session

The Better Auth session represented by an HTTP-only cookie. It is the normal
credential for a first-party web application or same-origin BFF.

### OAuth identity

The authenticated subject represented by a verified OAuth access token. It
also contains protocol metadata such as the client ID and granted scopes.

### Product actor

An application-owned representation created after authentication. A product
actor may include an application user, active team, organization, role,
permissions, or a product API key. The kit never creates it.

## Design principles

### Return identity, not business context

The successful output is a stable authenticated identity. It does not contain
an application account, organization, team, membership, or permission.

### Keep protocol policy centralized

Issuer, audience/resource, token signature, expiry, OAuth discovery, PKCE,
redirect safety, session-cookie safety, and challenges are security protocol
concerns and should behave consistently across products.

### Let Better Auth own Better Auth behavior

The kit configures and composes Better Auth. It must not reimplement token
issuance, authorization-code exchange, refresh-token rotation, OAuth state,
PKCE verification, session signing, or provider callbacks.

### Fail closed

An explicitly supplied invalid bearer token returns `401 invalid_token`. It
must never silently fall back to an ambient browser session. Missing and
invalid credentials are distinct outcomes.

### Do not force persistence

The kit consumes a configured Better Auth instance or its resource client. The
application supplies the Better Auth adapter and schema. The kit does not
export canonical Drizzle tables from its main entry point.

### Add adapters only for demonstrated consumers

Phase 1 supports framework-neutral primitives and the Express adapter used by
the existing products. There is no ts-rest-specific layer. A Next.js helper or
another server adapter is added only when it removes meaningful repeated code
without acquiring product logic.

## Deployment model

Each product deploys the kit in its own authentication/API service:

```text
SendLit API
├── SendLit Better Auth configuration and persistence
├── oauth-server-kit routes and verification
└── SendLit authorization, organization, team, and key logic

FrontLit API
├── FrontLit Better Auth configuration and persistence
├── oauth-server-kit routes and verification
└── FrontLit authorization, team, account, and key logic

MediaLit API
├── MediaLit Better Auth configuration and persistence
├── oauth-server-kit routes and verification
└── MediaLit authorization, tenancy, key, and signature logic
```

Consequences:

- the same person has independent product identities in each product, even
  when those identities use the same email address;
- signing keys, OAuth clients, consents, sessions, and callback URLs are scoped
  to a product deployment;
- a compromise or schema migration in one product does not automatically
  affect the other products; and
- MediaLit can adopt the kit before moving from MongoDB to PostgreSQL, provided
  it supplies a Better Auth-supported persistence strategy.

## Authentication result contract

The package exposes one neutral, discriminated identity shape:

```ts
export type AuthenticatedIdentity =
    | {
          method: "session";
          /** Canonical Better Auth issuer/base-path URL for this product. */
          issuer: string;
          /** Stable Better Auth user ID. */
          subject: string;
          email: string;
          name?: string | null;
          scopes: [];
      }
    | {
          method: "oauth";
          /** Validated OAuth `iss`. */
          issuer: string;
          /** Validated OAuth `sub`. */
          subject: string;
          email?: string;
          name?: string | null;
          clientId: string;
          scopes: string[];
          audiences: string[];
      };

export type AuthenticationResult =
    | { status: "authenticated"; identity: AuthenticatedIdentity }
    | { status: "missing" }
    | { status: "invalid_token" }
    | { status: "unavailable"; cause?: unknown };
```

Contract rules:

- `subject` is the Better Auth user ID or OAuth `sub` claim, not a product
  account ID.
- `issuer` is always the canonical issuer configured for the current product.
  It is carried for validation and diagnostics, not cross-product identity
  linking.
- The package must not create an application user as a side effect of token
  verification.
- `scopes` are normalized, de-duplicated strings.
- `clientId` is taken from the validated authorized-party/client claim and is
  required for OAuth identities.
- `audiences` contains only audiences/resources validated by the verifier.
- Token claims not explicitly included in the neutral contract are not exposed
  as trusted product authorization context.
- `unavailable` is reserved for an authentication dependency failure. A bad or
  expired token is `invalid_token`, not `unavailable`.
- Public functions return the result union for expected authentication
  outcomes and throw only for invalid application configuration or programmer
  errors.

A product composes it as follows:

```ts
const authentication = await verifyOAuthAccessToken(
    oauthVerificationOptions,
    bearerToken,
);
if (authentication.status !== "authenticated") {
    return sendAuthenticationError(authentication);
}

const actor = await productAuth.resolveActor(authentication.identity.subject);
if (!actor) return response.status(403).json({ error: "forbidden" });

const authorization = await productAuth.authorize(actor, requestedAction);
```

The application may also resolve its own API key. That resolver is a sibling of
the kit call, not an adapter passed into the kit.

## Minimal public API

Phase 1 exposes the following API. Names, request fields, result fields, and
entry points are frozen for the `0.1.0` implementation. A change requires a
documented package API change; an implementer must not substitute a different
request identity shape.

### Shared dependency contracts

The package accepts narrow structural interfaces so consumers are not exposed
to Better Auth's full inferred application type:

```ts
export type BetterAuthSession = {
    user: {
        id: string;
        email: string;
        name?: string | null;
    };
    session: {
        id: string;
        expiresAt: Date;
    };
};

export interface BetterAuthSessionApi {
    api: {
        getSession(input: {
            headers: Headers;
        }): Promise<BetterAuthSession | null>;
    };
}

import type { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";

type ConfiguredResourceClientAuth = {
    options: { baseURL?: string; basePath?: string };
    $context: Promise<unknown>;
};

export type OAuthResourceClient = ReturnType<
    typeof oauthProviderResourceClient<ConfiguredResourceClientAuth>
>;
```

Consumers pass the real Better Auth instance and OAuth resource client. The
session boundary remains structural; the resource-client alias intentionally
tracks Better Auth's official client type so supported-version changes fail at
compile time instead of being hidden behind `any`.

### Core and Better Auth integration

```ts
export interface ResolveBetterAuthSessionOptions {
    auth: BetterAuthSessionApi;
    issuer: string;
}

export function resolveBetterAuthSession(
    options: ResolveBetterAuthSessionOptions,
    headers: Headers,
): Promise<AuthenticationResult>;

export interface VerifyOAuthAccessTokenOptions {
    oauthResourceClient: OAuthResourceClient;
    issuer: string;
    audiences: readonly string[];
    resourceMetadataMappings?: Readonly<Record<string, string>>;
}

export function verifyOAuthAccessToken(
    options: VerifyOAuthAccessTokenOptions,
    token: string,
): Promise<AuthenticationResult>;

export interface CreateOAuthProviderOptionsInput {
    loginPage: string;
    consentPage: string;
    scopes: readonly string[];
    validAudiences: readonly string[];
    allowDynamicClientRegistration?: boolean;
    allowUnauthenticatedDynamicClientRegistration?: boolean;
    clientRegistrationDefaultScopes?: readonly string[];
    clientRegistrationAllowedScopes?: readonly string[];
}

import type { OAuthOptions } from "@better-auth/oauth-provider";

export function createOAuthProviderOptions(
    input: CreateOAuthProviderOptionsInput,
): OAuthOptions<string[]>;
```

- `resolveBetterAuthSession` calls the configured Better Auth instance and
  maps a valid session user to `AuthenticatedIdentity`.
- `verifyOAuthAccessToken` validates signature, issuer, expiry, and configured
  audience/resource through Better Auth's OAuth resource client.
- `createOAuthProviderOptions` applies secure shared defaults while accepting
  product URLs, scopes, audiences, and explicit client-registration policy.
- `allowDynamicClientRegistration` and
  `allowUnauthenticatedDynamicClientRegistration` default to `false`.
- Setting unauthenticated registration to `true` while dynamic registration is
  `false` is invalid configuration and throws during startup.
- Registration default and allowed scopes must be subsets of `scopes`.
  Violations throw during startup.
- The application still creates the Better Auth instance and supplies its
  database adapter, login providers, secret, and product hooks.

### Hosted pages

```ts
export type HostedLoginMethod =
    | {
          type: "email-otp";
          label?: string;
      }
    | {
          type: "social";
          providerId: string;
          label: string;
      };

export interface CreateOAuthPagesRouterOptions {
    appName: string;
    authBasePath: string;
    allowedRedirectOrigins: readonly string[];
    defaultRedirectUrl: string;
    loginMethods: readonly HostedLoginMethod[];
    legacyHostOnlySessionCookieNames?: readonly string[];
    logoUrl?: string;
    faviconUrl?: string;
    primaryColor?: string;
}

export function createOAuthPagesRouter(
    options: CreateOAuthPagesRouterOptions,
): Express.Router;
```

The router provides:

- `GET /login` for ordinary first-party login;
- `GET /oauth/login` for an in-progress OAuth authorization request; and
- `GET /oauth/consent` for OAuth consent.

Hosted-page rules:

- `authBasePath` must be an absolute path beginning with `/` and is used for
  every Better Auth browser request. `/api/auth` is not hard-coded.
- `allowedRedirectOrigins` must contain exact HTTPS origins in production.
- `defaultRedirectUrl` must belong to an allowed origin.
- `loginMethods` must contain at least one entry with unique method/provider
  identifiers.
- An email-OTP method uses Better Auth's email-OTP endpoints below
  `authBasePath`.
- A social method calls Better Auth social sign-in using its configured
  `providerId`. The router does not store or receive provider credentials.
- The router renders only the supplied methods; Google is not special-cased.
- Unsupported or invalid configuration throws synchronously at router
  creation.

Team/workspace selection is not part of these pages. If a product requires a
tenant selection step, it implements that step with its own Better Auth/OAuth
hooks and validates its own memberships.

### REST bearer middleware

```ts
declare global {
    namespace Express {
        interface Request {
            /** Present only after successful oauth-server-kit authentication. */
            auth?: AuthenticatedIdentity;
        }
    }
}

export interface CreateOAuthBearerMiddlewareOptions extends VerifyOAuthAccessTokenOptions {
    /** Added to `WWW-Authenticate` for MCP resources. */
    resourceMetadataUrl?: string;
}

export function createOAuthBearerMiddleware(
    options: CreateOAuthBearerMiddlewareOptions,
): Express.RequestHandler;
```

The middleware:

- reads only `Authorization: Bearer <token>`;
- verifies the token through `verifyOAuthAccessToken`;
- attaches the neutral identity to `req.auth`;
- returns a standard `401` for missing or invalid credentials; and
- never resolves product API keys, application users, teams, or permissions.

`req.auth` is optional in the global type because unauthenticated Express
routes exist. A handler mounted after this middleware may assert its presence.
The middleware never writes `req.user`, `req.account`, `req.teamId`, or an
application-specific request field.

If the Authorization header is present but malformed or uses another scheme,
the middleware returns the same `401` bearer-required response as a missing
header. If a bearer token is present but verification fails, it returns
`invalid_token`. Neither case calls `next()`.

The same middleware can run before a normal Express handler or a ts-rest
handler. Applications that need custom response control may call the
framework-neutral verifier directly.

### MCP discovery and authentication

```ts
export interface CreateMcpOAuthDiscoveryRoutesOptions {
    auth: BetterAuthMetadataApi;
    oauthResourceClient: OAuthResourceClient;
    resourceUrl: string;
    scopesSupported: readonly string[];
    allowedOrigins: readonly string[] | "*";
}

export interface BetterAuthMetadataApi {
    options: {
        baseURL?: string;
        basePath?: string;
    };
    api: {
        getOAuthServerConfig: (...args: never[]) => unknown;
        getOpenIdConfig: (...args: never[]) => unknown;
    };
}

export function createMcpOAuthDiscoveryRoutes(
    options: CreateMcpOAuthDiscoveryRoutesOptions,
): Express.Router;
```

The discovery router derives the canonical authorization-server identifier
from `auth.options.baseURL + auth.options.basePath` and publishes:

- OAuth authorization-server metadata at the root compatibility path and the
  RFC 8414 path-aware location
  `/.well-known/oauth-authorization-server/<issuer-path>`;
- OIDC configuration at the root compatibility path and the path-aware
  `<issuer-path>/.well-known/openid-configuration` location when enabled by
  Better Auth;
- protected-resource metadata at the bare compatibility path; and
- protected-resource metadata at the resource-specific canonical path.

Protected-resource metadata advertises the full canonical authorization
server identifier, including the Better Auth base path. Advertising only the
host origin is invalid when the issuer is, for example,
`https://api.example.com/api/auth`.

The MCP endpoint uses `createOAuthBearerMiddleware` with its
`resourceMetadataUrl`. The middleware then produces the `WWW-Authenticate:
Bearer resource_metadata="..."` challenge that directs the MCP client to the
protected-resource metadata. A separate challenge middleware is unnecessary.
The discovery router does not know about MCP tools or product authorization.

`allowedOrigins` is explicit. `"*"` is allowed only for public metadata
endpoints and never enables credentialed CORS. Product API-key headers are not
accepted as discovery-router configuration.

### Package entry points

Dependencies should be isolated with subpath exports:

```text
@codelitdev/oauth-server-kit
@codelitdev/oauth-server-kit/better-auth
@codelitdev/oauth-server-kit/express
@codelitdev/oauth-server-kit/mcp
```

The exact exports are:

| Entry point    | Exports                                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| package root   | `AuthenticatedIdentity`, `AuthenticationResult`, `OAuthResourceClient`, `VerifyOAuthAccessTokenOptions`, `verifyOAuthAccessToken`                                                        |
| `/better-auth` | `BetterAuthSession`, `BetterAuthSessionApi`, `ResolveBetterAuthSessionOptions`, `resolveBetterAuthSession`, `CreateOAuthProviderOptionsInput`, `createOAuthProviderOptions`              |
| `/express`     | `HostedLoginMethod`, `CreateOAuthPagesRouterOptions`, `createOAuthPagesRouter`, `CreateOAuthBearerMiddlewareOptions`, `createOAuthBearerMiddleware`, Express `Request.auth` augmentation |
| `/mcp`         | `BetterAuthMetadataApi`, `CreateMcpOAuthDiscoveryRoutesOptions`, `createMcpOAuthDiscoveryRoutes`                                                                                         |

There is no default export. The root does not import Express or Drizzle.
Express is a peer dependency only for `/express` and `/mcp`. Better Auth and
the OAuth Provider are peer dependencies for their corresponding entry
points. Drizzle is not a runtime or peer dependency of the package.

There is no `/ts-rest` entry point. There is no `/teams`, `/organizations`,
`/api-keys`, or `/authorization` entry point.

## Surface behavior

### Web applications

The recommended first-party web architecture is:

```text
Browser -> web app/BFF -> Better Auth session validation -> identity
                                                   -> product authorization
```

Requirements:

- Session cookies are HTTP-only and secure in production.
- SameSite and cookie-domain settings are explicit per deployment.
- Prefer a same-origin auth proxy/BFF. If the web and API use sibling
  subdomains, shared-parent-domain cookies may be enabled deliberately.
- A production deployment must have a non-empty canonical Better Auth URL.
- Trusted origins and post-login redirects use explicit allowlists.
- A login redirect preserves only a validated, same-product return URL.
- An expired or invalid session is cleared and results in one redirect to
  login; it must not create an app-to-login redirect loop.
- A login page must validate the session before redirecting an apparently
  signed-in user. Cookie presence alone is insufficient.
- When migrating from host-only to parent-domain session cookies, stale
  host-only copies must be retired on every participating host. The hosted
  `/login` and `/oauth/login` paths must apply the API-host cleanup policy.
- Logout revokes the Better Auth session and expires every cookie variant that
  the deployment may have issued.

The kit may provide a framework-neutral session guard. Page routing and UI
authorization remain in the web application.

### Mobile applications

The mobile application is an OAuth public client:

```text
Mobile app -> system browser -> authorization endpoint
           <- redirect URI with authorization code
Mobile app -> token endpoint with code verifier
           <- access token and optional refresh token
```

Requirements:

- Use Authorization Code with S256 PKCE.
- A public mobile client has no embedded client secret.
- Use the operating system browser, not an embedded password webview.
- Register exact application redirect URIs.
- Validate `state` and issuer through the supported client library.
- Store refresh tokens in platform secure storage.
- Request `offline_access` only when background access is required.
- Access tokens target an explicit product REST or MCP resource.

The kit supplies the server-side OAuth capability. Native navigation, secure
storage, and token-refresh code belong to the mobile client or its standard
OAuth library.

#### Phase 1 client registration policy

- First-party web and mobile OAuth clients are registered explicitly by each
  product through deployment/bootstrap configuration.
- A mobile client is registered as a public client, has no client secret, uses
  exact redirect URIs, and requires S256 PKCE.
- A server-side web OAuth client is registered as a confidential client and
  stores its secret only on the server. PKCE remains enabled.
- Known MCP clients may be registered explicitly.
- Dynamic Client Registration is disabled by default. A product may enable it
  for public MCP clients when interoperability requires it.
- Unauthenticated Dynamic Client Registration is a second, independent opt-in
  and may be enabled only when dynamic registration is enabled.
- Dynamically registered clients receive only the configured registration
  default/allowed scopes. They never receive product membership or permission
  through registration.
- Phase 1 does not provide a client-management UI. Products use Better Auth's
  server API or a deployment bootstrap to manage clients.

### REST APIs

The REST API accepts an OAuth access token in the Authorization header:

```http
Authorization: Bearer <access-token>
```

Verification must cover:

- signature against the expected signing keys;
- issuer;
- expiry and not-before constraints;
- configured audience/resource; and
- OAuth client and granted scopes.

After verification, the REST API maps `identity.subject` to its application
user and performs tenant and permission checks. Missing product membership or
permission normally returns `403`; it must not be represented as an invalid
OAuth token.

A product may separately accept an API key. Its own middleware defines whether
OAuth and the product key are alternatives and how an invalid explicit product
key behaves.

### MCP servers

An unauthenticated MCP request follows this sequence:

```text
MCP client -> protected MCP endpoint
MCP server -> 401 + WWW-Authenticate resource_metadata URL
MCP client -> protected-resource metadata
MCP client -> authorization-server metadata
MCP client -> OAuth Authorization Code + PKCE flow
MCP client -> retries MCP request with Bearer token
MCP server -> neutral identity -> product tool authorization
```

Requirements:

- The advertised resource exactly matches the audience/resource used in token
  verification.
- Protected-resource metadata is available at the path expected for that MCP
  resource.
- Discovery endpoints support the browser/client CORS behavior required for
  discovery without reflecting unnecessary application headers.
- Dynamic Client Registration is opt-in per deployment. If enabled for public
  MCP clients, its risk and allowed scopes are configured by the product.
- Products may add Better Auth's CIMD plugin for MCP client discovery. The
  product supplies a secure metadata fetch transport; the OAuth Provider's
  discovery response advertises CIMD support through this kit's metadata route.
- Every MCP tool performs product authorization after authentication.
- The kit never infers team access from an OAuth token.

## OAuth server configuration

The application supplies:

- canonical issuer/base URL and Better Auth base path;
- application name;
- login and consent page URLs;
- exact trusted origins and redirect URI policy;
- valid REST and MCP resources/audiences;
- supported OAuth scopes and human-readable scope descriptions;
- trusted first-party OAuth clients;
- whether Dynamic Client Registration is enabled;
- login providers such as email OTP or Google;
- Better Auth secret and signing-key persistence; and
- the configured Better Auth instance and resource client.

The kit supplies secure defaults:

- authorization-code flow;
- S256 PKCE required by default;
- no wildcard redirect URIs;
- no unauthenticated Dynamic Client Registration unless explicitly enabled;
- issuer and resource validation;
- consent for untrusted clients/scopes;
- safe OAuth query continuation;
- non-embeddable login and consent pages; and
- consistent authentication errors.

The auth base path must be configurable. Hosted pages must not hard-code
`/api/auth` when calling Better Auth endpoints.

The login page renders only providers configured by the consuming application.
For example, it must not render a Google button when Google login is disabled.
The application owns OTP delivery callbacks and social-provider secrets.

### Social login and per-product enterprise SSO

Social login is a Phase 1 authentication input, not a separate identity model.
Each product independently configures its Better Auth social providers and
passes matching `social` entries to `loginMethods`. Successful email OTP and
social login both resolve to that product's Better Auth user and session.

Rules:

- The kit never contains Google, Apple, GitHub, Microsoft, or another
  provider's credentials.
- Provider callbacks remain below the configured Better Auth base path.
- The product configures Better Auth account-linking policy. The kit does not
  link accounts by email or treat an email address as a permission.
- A provider button is rendered only when the product explicitly supplies the
  corresponding login method.
- Provider failure returns to the hosted login page with a safe generic error;
  provider tokens and error payloads are not exposed in the page.

Enterprise OIDC or SAML SSO is a later, optional authentication method for an
individual product. It is implemented by that product adding Better Auth's SSO
plugin and by a later compatible hosted-page login method. The kit may
centralize the generic login handoff, callback safety, and error presentation.
It must not provision or select a SendLit organization, FrontLit team, or
MediaLit tenant. Any application-user or membership provisioning callback
belongs to the product.

Enabling enterprise SSO in SendLit has no effect on FrontLit or MediaLit. There
is no shared CodeLit session, shared issuer, shared user table, or cross-product
account linking.

## Persistence boundary

The kit does not define canonical database tables.

Each application uses Better Auth's supported adapter and migration tooling to
store authentication data, including users, linked provider accounts,
sessions, verifications, OAuth clients, consents, refresh tokens, access-token
records when required, and signing keys.

Rules:

- The root package has no Drizzle peer dependency.
- The package does not require custom `auth_*` model names.
- Applications may keep Better Auth's default model names.
- Applications may extend Better Auth's user model with application fields,
  but the kit must not rely on those fields.
- Product tables and foreign keys are never exported from this package.
- If a small Drizzle example remains useful, it belongs in examples or an
  explicitly optional subpath and is not the canonical schema.
- A database change in one product must not require a package release for
  another product.

## Error semantics

### Missing credential

REST response:

```json
{
    "error": "unauthorized",
    "error_description": "A Bearer access token is required"
}
```

Status is `401`. An MCP resource also includes its `WWW-Authenticate` discovery
challenge.

### Invalid or expired credential

```json
{
    "error": "invalid_token",
    "error_description": "The access token is invalid or expired"
}
```

Status is `401`. An explicit invalid token never falls through to a browser
session or product API key.

### Authentication service unavailable

```json
{
    "error": "authentication_unavailable"
}
```

Status is `503`. Internal causes are logged through the configured observer but
are not returned to the caller.

### Authenticated but forbidden

`403` is emitted by the application, not the kit. Error names and product
details are application-owned.

## Security requirements

- Require HTTPS outside local development.
- Require a strong Better Auth secret in every deployment.
- Keep OAuth signing keys stable across application restarts and replicas.
- Validate issuer and resource/audience on every access token.
- Require S256 PKCE for public clients and keep it enabled for confidential
  clients unless a documented legacy exception exists.
- Use exact redirect URI matching and trusted-origin allowlists.
- Never log authorization codes, access tokens, refresh tokens, OTPs, session
  cookies, client secrets, or Better Auth secrets.
- Store confidential client secrets hashed or encrypted using Better Auth's
  supported configuration.
- Protect login and consent pages from framing.
- Apply rate limits to OTP send/verify, login, consent, registration, and token
  endpoints at the deployment boundary.
- Preserve OAuth state and issuer validation in client flows.
- Do not expose raw, unvalidated token claims as application permissions.
- Treat browser cookie authentication and bearer authentication as separate
  entry points. A middleware invocation uses one declared method.
- Validate configuration at startup and refuse production startup for an empty
  issuer URL, missing secret, non-HTTPS public URL, or invalid resource URL.
- Do not enable unauthenticated Dynamic Client Registration by default.

## Observability

Phase 1 does not add a logging or telemetry abstraction to the public API.
Consumers observe middleware status codes and `AuthenticationResult` outcomes
using their existing application telemetry. Better Auth remains responsible
for its own operational hooks.

Applications may record issuer, client ID, method, outcome, reason code, and
duration. They must not record email addresses, OTPs, cookies, authorization
codes, access tokens, refresh tokens, or secrets. A package-level observer may
be considered later only if all consumers demonstrate the same requirement.

## Current code disposition

The present package contains useful protocol code mixed with product-oriented
abstractions. Phase 1 applies this disposition:

| Current module            | Decision                               | Reason                                                                                                                                                             |
| ------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `oauth-pages.ts`          | Keep and narrow                        | Hosted login and consent are authentication concerns. Remove team UI, make auth base path/providers configurable, and apply cookie migration cleanup consistently. |
| `resolve-bearer-token.ts` | Keep and replace raw-claims output     | Token verification is core. Return `AuthenticationResult`, not arbitrary claims such as `team_id`.                                                                 |
| `mcp-discovery.ts`        | Keep and narrow                        | OAuth/MCP discovery is core. Remove product API-key header configuration.                                                                                          |
| `central-auth.ts`         | Remove before the first stable release | Account creation, product API keys, membership validation, team claims, credential precedence, and product request projection are outside authentication.          |
| `team-selection.ts`       | Remove from the core package           | Team selection and membership validation are application business logic. A product may implement its own OAuth hook.                                               |
| `schema.ts`               | Remove from the root API               | A concrete Drizzle schema prevents database-neutral adoption and forces model names. Consumers use Better Auth's schema tooling.                                   |
| `index.ts`                | Replace broad star exports             | Export only the narrow public contract and explicit subpaths.                                                                                                      |

Because the package is private, early, and has no stable production contract,
Phase 1 should make these breaking changes directly instead of maintaining the
over-scoped API indefinitely.

## Product integration boundaries

### SendLit

The kit replaces or centralizes:

- hosted OAuth login and consent pages;
- Better Auth session-to-neutral-identity mapping;
- OAuth bearer verification;
- OAuth/OIDC discovery; and
- MCP protected-resource discovery and challenge behavior.

SendLit retains:

- Better Auth database configuration and user extensions;
- default-organization initialization hooks;
- organization and team memberships;
- active organization/team selection;
- organization and team API keys;
- request actor/context projection;
- scopes-to-permissions mapping; and
- all delivery, ESP, grant, and quota behavior.

### FrontLit

FrontLit retains its account, team, membership, API-key, and permission
resolvers. Its current use of the package's central-auth and team-selection
abstractions is migrated back into FrontLit-owned middleware/hooks.

The kit returns a Better Auth subject. FrontLit maps that subject to its
application account and validates team membership after authentication.

### MediaLit

MediaLit can adopt hosted OAuth, session identity, bearer verification, and MCP
discovery independently of its planned PostgreSQL migration. Its MediaLit API
keys and upload signatures remain separate product authenticators.

Moving MediaLit from MongoDB later is a MediaLit/Better Auth persistence
migration and does not change the package's authentication contract.

## Implementation phases

### Phase 1: lean market-ready authentication core

This is the launch boundary.

1. Implement the frozen public types, functions, subpath exports, and
   `req.auth` augmentation defined in this PRD.
2. Replace raw bearer claims with neutral identity output.
3. Add Better Auth session identity resolution.
4. Narrow hosted pages to login and consent only.
5. Make the auth base path configurable and implement configured email-OTP and
   social login methods without a hard-coded provider.
6. Fix stale-cookie cleanup for both ordinary and OAuth login entry points.
7. Narrow MCP discovery and add the standard bearer challenge.
8. Add the thin Express bearer middleware.
9. Split exports so framework and database dependencies are isolated.
10. Remove `central-auth`, team selection, product API-key support, and the
    canonical Drizzle schema from the public API.
11. Enforce static registration for first-party web/mobile clients and
    explicit opt-in Dynamic Client Registration for MCP interoperability.
12. Add the normative Bun test, coverage, HTTP integration, and consumer test
    gates.
13. Migrate FrontLit to application-owned account/team/API-key middleware.
14. Document one integration for web, mobile, REST, and MCP.

Phase 1 does not require SendLit or MediaLit to adopt the kit. It produces a
stable narrow contract against which each can migrate.

### Phase 2: SendLit adoption

1. Replace SendLit's duplicate hosted OAuth and discovery code.
2. Keep SendLit's existing product credential and tenant resolver intact.
3. Map session/OAuth identities into SendLit's existing request context.
4. Verify web login, REST OAuth, and MCP OAuth end to end.
5. Remove only the SendLit OAuth code made redundant by the package.

### Phase 3: MediaLit adoption

1. Introduce Better Auth using a persistence strategy chosen by MediaLit.
2. Mount hosted OAuth and discovery routes.
3. Protect REST and MCP bearer paths.
4. Retain MediaLit API keys and signatures in MediaLit middleware.
5. Migrate persistence to PostgreSQL later without changing the kit API.

### Later extensions

- independent per-product enterprise OIDC/SAML login through Better Auth;
- service-to-service OAuth client credentials;
- additional HTTP-framework adapters;
- richer branding/theming.

None of these is required for the authentication kit's first stable release.

## Test plan

### Test framework and coverage gate

Bun test is the only package test runner. Bun's coverage support is used. The
package defines these scripts:

```json
{
    "scripts": {
        "test": "bun test",
        "test:watch": "bun test --watch",
        "test:coverage": "bun test --coverage"
    }
}
```

`bun test --coverage` is a required CI and release gate. Coverage includes every
non-test TypeScript source file shipped by the package and may exclude only
type-declaration files and generated artifacts. Difficult security or protocol
code must not be excluded to satisfy the threshold.

Minimum global thresholds are:

| Metric     | Required |
| ---------- | -------: |
| Statements |      90% |
| Lines      |      90% |
| Functions  |      90% |
| Branches   |      80% |

Unit tests mock protocol dependencies only where the unit boundary requires
it. Express routers are tested through a real ephemeral HTTP listener using
Node's `fetch`. At least one integration suite uses a real Better Auth instance,
OAuth Provider plugin, and temporary Better Auth-supported test database to
exercise authorization-code, PKCE, token, refresh, session, and discovery
behavior. No test calls a live social provider or production service.

### Contract tests

- A valid session returns a `session` identity with the Better Auth subject.
- An expired, revoked, or malformed session does not authenticate.
- A valid access token returns an `oauth` identity with subject, client ID,
  normalized scopes, and validated audience.
- Invalid signature, issuer, audience, expiry, or not-before returns
  `invalid_token`.
- Verification never creates an application account or queries membership.
- Raw `team_id`, `organization_id`, roles, and permissions are not projected
  into the neutral identity.
- Every documented root and subpath export has a compile-time and runtime
  public-API test.
- Importing the root does not load Express, Drizzle, or application modules.
- `req.auth` is populated only after successful bearer verification.

### Hosted-page tests

- Ordinary login completes and returns only to an allowlisted origin.
- OAuth login preserves Better Auth's signed OAuth continuation.
- Consent accept and deny both resume the correct OAuth flow.
- Google or another social button appears only when configured.
- A custom Better Auth base path is used for page API calls.
- Email OTP and every configured social provider render and call the correct
  Better Auth route; unconfigured providers do not render.
- Login and consent pages cannot be framed.
- Malicious display values are HTML/script escaped.
- `/login` and `/oauth/login` both clear configured legacy API-host cookies.
- Invalid/expired cookies do not produce a redirect loop.

### Web tests

- A valid first-party session protects a server-rendered page/BFF route.
- A revoked session redirects to login once.
- Login returns to the original allowlisted page.
- Logout revokes the session and clears applicable cookies.
- Same-origin proxy and configured sibling-subdomain deployments both work.

### Mobile tests

- A public client completes Authorization Code with S256 PKCE.
- A public client cannot rely on a client secret.
- An invalid verifier fails the token exchange.
- An unregistered redirect URI is rejected.
- Refresh succeeds only when the proper scope and valid refresh token exist.
- A statically registered public client completes the full flow without a
  client secret.

### REST tests

- Express middleware runs successfully before a ts-rest handler.
- Missing bearer returns the documented `401`.
- Invalid bearer returns `invalid_token` and does not fall back.
- A valid identity reaches product authorization without product fields added
  by the kit.
- Product `403` behavior is unaffected by the package.

### MCP tests

- Bare and resource-specific protected-resource metadata are reachable.
- Authorization-server and OIDC discovery identify the configured issuer.
- The unauthenticated endpoint returns a valid `WWW-Authenticate` challenge.
- The advertised MCP resource equals the verified token audience/resource.
- A standard MCP client can discover, authorize with PKCE, and retry.
- Dynamic Client Registration is rejected by default and succeeds only in the
  explicit opt-in test configuration.
- A valid token does not itself grant access to a product tool; application
  authorization still runs.

### Consumer tests

- FrontLit retains session, OAuth, and product API-key behavior after removing
  central-auth from the package.
- SendLit can compose session, OAuth, organization-key, and team-key identities
  without the kit knowing about either key type.
- MediaLit can compile the root and OAuth verification entry points without a
  Drizzle dependency.

## Phase 1 acceptance criteria

Phase 1 is complete when all of the following are true:

- The public contract authenticates only sessions and OAuth access tokens.
- The public API exactly matches the types, functions, `req.auth` field, and
  subpath export table in this PRD.
- No public type or callback mentions account, team, organization, membership,
  role, permission, quota, or product API key.
- Root imports do not require Express or Drizzle at runtime.
- Hosted login and consent work with a configurable Better Auth base path.
- Web session validation works without redirect loops caused by stale cookies.
- Public OAuth clients can complete Authorization Code with S256 PKCE.
- A statically registered public mobile client completes Authorization Code
  with S256 PKCE and no client secret.
- Dynamic Client Registration is disabled unless explicitly enabled.
- REST bearer middleware works before existing ts-rest handlers.
- MCP discovery and bearer challenges pass an end-to-end client smoke test.
- Issuer, resource/audience, signature, and expiry are verified for every
  bearer token.
- Invalid explicit bearers fail closed.
- FrontLit owns its account/team/API-key mapping after migration.
- Unit, integration, and consumer tests pass.
- `bun test --coverage` passes the 90% statement, line, and function thresholds
  and the 80% branch threshold.
- Integration documentation exists for all four supported surfaces.

## Risks and mitigations

### Authentication and authorization become accidentally coupled again

Mitigation: reject public APIs containing product tenant, membership, role, or
API-key concepts. Review the public type surface as a Phase 1 launch gate.

### Consumers duplicate product credential precedence

That precedence is legitimately product-specific. Mitigation: document small
product-local composition examples without moving the policy into the kit.

### Better Auth releases change plugin types or endpoints

Mitigation: pin compatible peer ranges, run integration tests against the
supported versions, wrap only stable behavior, and avoid copying Better Auth
protocol internals.

### Cross-domain cookies cause web login loops

Mitigation: validate deployment URLs, prefer same-origin proxies, test shared
parent-domain cookies explicitly, clear legacy host-only cookies, and validate
the session rather than trusting cookie presence.

### Dynamic Client Registration increases attack surface

Mitigation: keep it disabled by default, allow only public clients when
unauthenticated registration is necessary, restrict allowed scopes, and rate
limit registration.

### Social or enterprise account linking grants unintended access

Mitigation: Better Auth provider/account linking is configured independently
by each product. The kit never links users by email and never turns provider
claims into application membership, roles, or permissions.

### A neutral identity is mistaken for permission

Mitigation: name the result `AuthenticatedIdentity`, exclude roles and tenants,
and require product authorization in every integration example and test.

## Explicit decisions

- The package remains named `oauth-server-kit`.
- It is an embedded library, not a centralized SSO service.
- Every product has an independent issuer, Better Auth users, sessions, OAuth
  clients, and signing keys. Cross-product SSO is not supported or planned.
- Better Auth remains the OAuth and session engine.
- First-party web applications use Better Auth sessions.
- Mobile, REST, and MCP clients use OAuth access tokens.
- Authorization Code with S256 PKCE is the default interactive OAuth flow.
- First-party web and mobile clients are statically registered in Phase 1;
  Dynamic Client Registration is opt-in for MCP interoperability.
- Social login is configurable per product. Enterprise OIDC/SAML login may be
  added later per product without changing product authorization ownership.
- Product scopes are configured by the app and carried by the kit, but
  interpreted by the app.
- Product API keys are outside the package.
- Team and organization selection are outside the package.
- ts-rest requires no dedicated adapter.
- Persistence and Better Auth schema ownership remain with each product.
- Phase 1 intentionally removes the over-scoped central-auth API rather than
  preserving it as the architecture.

## References

- [Better Auth OAuth 2.1 Provider](https://better-auth.com/docs/plugins/oauth-provider)
- [Better Auth session management](https://better-auth.com/docs/concepts/session-management)
- [Better Auth cookie configuration](https://better-auth.com/docs/concepts/cookies)
- [Better Auth social login](https://better-auth.com/docs/basic-usage)
- [Better Auth per-product enterprise SSO](https://better-auth.com/docs/plugins/sso)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
