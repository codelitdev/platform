# Integration guide

This guide shows the common authentication layer. Database configuration,
application actors, tenants, permissions, API keys, and provider credentials
remain in the product.

## 1. Create the product-local Better Auth server

Use the product's supported Better Auth adapter and migrations. The issuer is
the public Better Auth URL including `basePath`—for example,
`https://api.example.com/api/auth`.

```ts
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins/email-otp";
import { jwt } from "better-auth/plugins/jwt";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { oauthProvider } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { createOAuthProviderOptions } from "@codelitdev/oauth-server-kit/better-auth";

const publicApiUrl = "https://api.example.com";
const authBasePath = "/api/auth";
export const issuer = `${publicApiUrl}${authBasePath}`;
export const restResource = `${publicApiUrl}/api`;
export const mcpResource = `${publicApiUrl}/mcp`;

export const auth = betterAuth({
    baseURL: publicApiUrl,
    basePath: authBasePath,
    secret: process.env.BETTER_AUTH_SECRET,
    database: productBetterAuthAdapter,
    trustedOrigins: ["https://app.example.com", publicApiUrl],
    plugins: [
        emailOTP({ sendVerificationOTP: productSendOtp }),
        jwt(),
        oauthProvider({
            ...createOAuthProviderOptions({
                loginPage: `${publicApiUrl}/oauth/login`,
                consentPage: `${publicApiUrl}/oauth/consent`,
                scopes: [
                    "openid",
                    "profile",
                    "email",
                    "offline_access",
                    "data:read",
                    "data:write",
                ],
                validAudiences: [restResource, mcpResource],
                clientRegistrationDefaultScopes: ["openid", "profile", "email"],
                clientRegistrationAllowedScopes: [
                    "offline_access",
                    "data:read",
                    "data:write",
                ],
            }),
            // Product-specific OAuth hooks may be spread here. A team-selection
            // hook, for example, is product authorization logic—not kit API.
        }),
        cimd({
            fetchClientMetadataResource,
            metadataProfile: "mcp-2026-07-28",
            // VS Code's no-store document is fetched again during token exchange.
            metadataFetchPolicy: { minimumFetchInterval: 0 },
        }),
    ],
});

export const oauthResourceClient = oauthProviderResourceClient(auth);
```

### MCP client registration with CIMD

Install a compatible `@better-auth/cimd` version in the product API. For Node
24, use `1.7.7` or newer to include the pinned DNS lookup callback fix. Keep
`better-auth` and `@better-auth/oauth-provider` on matching versions. The
`cimd()` plugin resolves HTTPS client ID metadata documents, validates them,
and adds
`client_id_metadata_document_supported: true` to the authorization-server
metadata. `createMcpOAuthDiscoveryRoutes` forwards that metadata from Better
Auth; do not set the flag by hand. Keep the OAuth Provider and CIMD plugin in
the product's Better Auth configuration so its resource, scopes, and client
policy stay with the product. An MCP client using CIMD hosts a metadata
document at its HTTPS `client_id` URL; the document's `client_id` must match
that URL exactly.

The example above uses Better Auth's secure Node transport. It pins a public
DNS result to the TLS connection and rejects redirects. Bun can use that
transport when its Node HTTPS compatibility preserves the custom DNS lookup
and TLS identity; verify those properties on the deployed Bun version. Other
runtimes need an equivalent transport. A DNS check followed by ordinary
`fetch` can resolve the hostname again. The transport also handles
discovery-owned resources such as client JWKS. Follow the
[@better-auth/cimd transport requirements](https://better-auth.com/docs/plugins/cimd)
when supplying a different fetcher.

CIMD is the preferred MCP client registration method. Keep DCR disabled for
first-party clients. If an older MCP client requires unauthenticated DCR, opt
in deliberately, restrict registration scopes, and rate-limit the registration
endpoint:

```ts
createOAuthProviderOptions({
    // other required fields...
    allowDynamicClientRegistration: true,
    allowUnauthenticatedDynamicClientRegistration: true,
    clientRegistrationDefaultScopes: ["openid"],
    clientRegistrationAllowedScopes: ["data:read", "data:write"],
});
```

Check the product's Better Auth database schema after a version upgrade, then
verify the advertised CIMD flag and a complete MCP authorization flow. When
supporting clients whose metadata uses `Cache-Control: no-store`, configure
`metadataFetchPolicy.minimumFetchInterval` so authorization and token exchange
can both retrieve the document; retain the plugin's concurrency and rate
limits. Keep any client-specific metadata compatibility rules explicit in the
product API.

## 2. Web app

Mount Better Auth's handler using its documented Node adapter, then mount the
hosted pages. Configure only login methods that Better Auth has actually been
configured to serve.

```ts
import { toNodeHandler } from "better-auth/node";
import { createOAuthPagesRouter } from "@codelitdev/oauth-server-kit/express";

app.all("/api/auth/*", toNodeHandler(auth));
app.use(
    createOAuthPagesRouter({
        appName: "Example",
        authBasePath: "/api/auth",
        allowedRedirectOrigins: ["https://app.example.com"],
        defaultRedirectUrl: "https://app.example.com/",
        loginMethods: [
            { type: "email-otp" },
            // Render only when the product configures Better Auth's Google provider.
            {
                type: "social",
                providerId: "google",
                label: "Continue with Google",
            },
        ],
        // Use only during a host-only to shared-domain cookie migration.
        legacyHostOnlySessionCookieNames: [
            "__Secure-better-auth.session_token",
            "__Secure-better-auth.session_data",
            "__Secure-better-auth.dont_remember",
        ],
    }),
);
```

For a BFF or server-rendered page, validate the session and then perform
product authorization:

```ts
import { fromNodeHeaders } from "better-auth/node";
import { resolveBetterAuthSession } from "@codelitdev/oauth-server-kit/better-auth";

const authentication = await resolveBetterAuthSession(
    { auth, issuer },
    fromNodeHeaders(request.headers),
);
if (authentication.status !== "authenticated") {
    return response.redirect(
        `/login?redirect=${encodeURIComponent(originalUrl)}`,
    );
}

const actor = await productAccounts.findByAuthSubject(
    authentication.identity.subject,
);
if (!actor) return response.status(403).json({ error: "forbidden" });
```

Prefer a same-origin web proxy. For sibling subdomains, configure Better Auth
cross-subdomain cookies explicitly, use HTTPS, and verify the cookie domain in
the deployed environment. Do not infer authentication from cookie presence;
always validate the session.

## 3. Mobile app

Register the first-party mobile app as a public/native OAuth client during
deployment or application bootstrap:

- exact custom-scheme or claimed-HTTPS redirect URI;
- `token_endpoint_auth_method: "none"`;
- `grant_types: ["authorization_code", "refresh_token"]`;
- `response_types: ["code"]`;
- no client secret in the app bundle.

The mobile app opens the authorization endpoint with `state`, `resource`, and
S256 PKCE:

```text
GET /api/auth/oauth2/authorize
  ?client_id=mobile-client-id
  &redirect_uri=com.example.app:/oauth/callback
  &response_type=code
  &scope=openid%20offline_access%20data:read
  &resource=https://api.example.com/api
  &state=random-csrf-value
  &code_challenge=base64url-sha256-verifier
  &code_challenge_method=S256
```

Exchange the code with the original verifier and no client secret. Store
refresh tokens in the OS secure credential store. Reject callback state or
issuer mismatches, and never accept an unregistered redirect URI.

## 4. REST API, including ts-rest

Mount the bearer middleware immediately before the protected router. ts-rest
needs no package-specific adapter because it consumes ordinary Express
middleware.

```ts
import { createOAuthBearerMiddleware } from "@codelitdev/oauth-server-kit/express";

const requireOAuth = createOAuthBearerMiddleware({
    oauthResourceClient,
    issuer,
    audiences: [restResource],
});

app.use("/api", requireOAuth, tsRestRouter);
```

`request.auth` is a neutral session/OAuth identity only after successful
authentication. Map `request.auth.subject` to the product actor, interpret
scopes, and return product-owned `403` responses after the package
middleware.

Scopes are only labels until the product enforces them, and the consent
screen shows them to the user. Keep the actor's permissions that the token's
granted scopes cover (for example, `data:read` for reads and `data:write`
for writes), so a token approved as read-only cannot write even when the
actor could. ADR 0008 describes the pattern; the template narrows tenant
permissions this way.

```ts
const actor = await productAccounts.findByAuthSubject(request.auth!.subject);
if (!actor || !(await productPolicy.canRead(actor))) {
    return response.status(403).json({ error: "forbidden" });
}
```

If the product also supports an application API key, compose it in
product-owned middleware. An explicit invalid bearer must not fall through to
a session or API key.

## 5. MCP server

Mount discovery at the application root and protect the MCP transport with a
bearer challenge that points to its resource metadata:

```ts
import { createMcpOAuthDiscoveryRoutes } from "@codelitdev/oauth-server-kit/mcp";
import { createOAuthBearerMiddleware } from "@codelitdev/oauth-server-kit/express";

app.use(
    createMcpOAuthDiscoveryRoutes({
        auth,
        oauthResourceClient,
        resourceUrl: mcpResource,
        // MCP clients request exactly these. Include offline_access so they
        // receive a refresh token instead of asking for consent again.
        scopesSupported: ["data:read", "data:write", "offline_access"],
        allowedOrigins: ["https://trusted-mcp-client.example.com"],
    }),
);

app.use(
    "/mcp",
    createOAuthBearerMiddleware({
        oauthResourceClient,
        issuer,
        audiences: [mcpResource],
        resourceMetadataUrl: `${publicApiUrl}/.well-known/oauth-protected-resource/mcp`,
    }),
    productMcpAuthorization,
    mcpTransport,
);
```

The router serves authorization-server, OIDC, bare protected-resource, and
resource-path protected-resource metadata. A valid OAuth token authenticates
the caller but does not by itself authorize an MCP tool; the product still
maps the subject and checks permissions.

## 6. Social login and later enterprise SSO

Configure social providers independently in each product's Better Auth
instance, then add matching `social` entries to `loginMethods`. Provider
credentials never enter this package.

An individual product can later add Better Auth's SSO plugin for enterprise
OIDC or SAML. That product remains responsible for account provisioning and
authorization. There is no shared CodeLit session, issuer, user table, or
cross-product account linking.

## 7. Required deployment checks

- Public URLs and redirect origins use HTTPS outside local development.
- `BETTER_AUTH_SECRET` is strong and stable.
- signing keys persist and are shared by replicas;
- issuer includes the configured Better Auth base path;
- every API/MCP resource is in both OAuth `validAudiences` and verifier
  `audiences`;
- OTP, login, consent, token, and registration endpoints are rate-limited;
- tokens, codes, OTPs, cookies, and secrets are excluded from logs; and
- first-party web/mobile OAuth clients are bootstrapped before release.
