import crypto from "node:crypto";
import express from "express";
import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { describe, expect, it } from "vitest";
import { withHttpServer } from "../test/http";
import {
    createOAuthProviderOptions,
    resolveBetterAuthSession,
} from "./better-auth";
import { createMcpOAuthDiscoveryRoutes } from "./mcp-discovery";
import { verifyOAuthAccessToken } from "./verify-access-token";

function createTestAuth(baseUrl: string, unauthenticatedDcr = false) {
    const authBasePath = "/api/auth";
    const resourceUrl = `${baseUrl}/mcp`;
    return betterAuth({
        appName: "OAuth Kit Test",
        baseURL: baseUrl,
        basePath: authBasePath,
        secret: "test-secret-that-is-at-least-thirty-two-characters-long",
        emailAndPassword: { enabled: true },
        plugins: [
            jwt(),
            oauthProvider(
                createOAuthProviderOptions({
                    loginPage: `${baseUrl}/oauth/login`,
                    consentPage: `${baseUrl}/oauth/consent`,
                    scopes: ["openid", "offline_access", "api.read"],
                    validAudiences: [resourceUrl],
                    allowDynamicClientRegistration: true,
                    allowUnauthenticatedDynamicClientRegistration:
                        unauthenticatedDcr,
                    clientRegistrationDefaultScopes: [
                        "openid",
                        "offline_access",
                        "api.read",
                    ],
                }),
            ),
        ],
    });
}

function pkce() {
    const verifier = crypto.randomBytes(32).toString("base64url");
    return {
        verifier,
        challenge: crypto
            .createHash("sha256")
            .update(verifier)
            .digest("base64url"),
    };
}

async function authorize(
    authBaseUrl: string,
    cookie: string,
    clientId: string,
    redirectUri: string,
    challenge: string,
) {
    const query = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid offline_access api.read",
        state: "state-123",
        code_challenge: challenge,
        code_challenge_method: "S256",
    });
    const authorization = await fetch(
        `${authBaseUrl}/oauth2/authorize?${query}`,
        { headers: { cookie }, redirect: "manual" },
    );
    const consentLocation =
        authorization.status === 302
            ? authorization.headers.get("location")
            : authorization.status === 200
              ? (((await authorization.json()) as { url?: string }).url ?? null)
              : null;
    if (consentLocation?.startsWith(redirectUri)) {
        const callback = new URL(consentLocation);
        expect(callback.searchParams.get("state")).toBe("state-123");
        return callback.searchParams.get("code")!;
    }
    expect(consentLocation).toContain("/oauth/consent?");
    const oauthQuery = new URL(consentLocation!).search.slice(1);

    const consent = await fetch(`${authBaseUrl}/oauth2/consent`, {
        method: "POST",
        headers: {
            cookie,
            origin: new URL(authBaseUrl).origin,
            "content-type": "application/json",
        },
        body: JSON.stringify({ accept: true, oauth_query: oauthQuery }),
    });
    expect(consent.status).toBe(200);
    const consentBody = (await consent.json()) as { url: string };
    const callback = new URL(consentBody.url);
    expect(callback.searchParams.get("state")).toBe("state-123");
    return callback.searchParams.get("code")!;
}

async function exchange(authBaseUrl: string, body: Record<string, string>) {
    return fetch(`${authBaseUrl}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
    });
}

describe("real Better Auth OAuth integration", () => {
    it("completes session, static public-client PKCE, refresh, verification, and discovery", async () => {
        const app = express();
        let auth!: ReturnType<typeof createTestAuth>;
        app.use((request, response, next) => {
            if (!request.path.startsWith("/api/auth/")) {
                next();
                return;
            }
            return toNodeHandler(auth)(request, response);
        });

        await withHttpServer(app, async (baseUrl) => {
            const authBasePath = "/api/auth";
            const authBaseUrl = `${baseUrl}${authBasePath}`;
            const resourceUrl = `${baseUrl}/mcp`;
            const redirectUri = "com.example.mobile:/oauth/callback";
            auth = createTestAuth(baseUrl);
            const oauthResourceClient = oauthProviderResourceClient(auth);
            app.use(
                createMcpOAuthDiscoveryRoutes({
                    auth,
                    oauthResourceClient,
                    resourceUrl,
                    scopesSupported: ["api.read"],
                    allowedOrigins: "*",
                }),
            );

            const signup = await auth.api.signUpEmail({
                body: {
                    name: "Integration User",
                    email: "integration@example.com",
                    password: "integration-password",
                },
                asResponse: true,
            });
            expect(signup.status).toBe(200);
            const cookie = signup.headers.get("set-cookie")!.split(";", 1)[0];

            const session = await resolveBetterAuthSession(
                { auth, issuer: authBaseUrl },
                new Headers({ cookie }),
            );
            expect(session).toMatchObject({
                status: "authenticated",
                identity: {
                    method: "session",
                    email: "integration@example.com",
                },
            });

            // This authenticated operator call represents first-party static
            // registration performed during deployment/bootstrap, not DCR.
            const client = await auth.api.createOAuthClient({
                headers: new Headers({ cookie }),
                body: {
                    client_name: "Static mobile client",
                    redirect_uris: [redirectUri],
                    token_endpoint_auth_method: "none",
                    grant_types: ["authorization_code", "refresh_token"],
                    response_types: ["code"],
                    application_type: "native",
                },
            });
            expect(client.client_secret).toBeUndefined();

            const proof = pkce();
            const code = await authorize(
                authBaseUrl,
                cookie,
                client.client_id,
                redirectUri,
                proof.challenge,
            );
            const tokenResponse = await exchange(authBaseUrl, {
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
                client_id: client.client_id,
                code_verifier: proof.verifier,
                resource: resourceUrl,
            });
            expect(tokenResponse.status).toBe(200);
            const token = (await tokenResponse.json()) as {
                access_token: string;
                refresh_token: string;
                token_type: string;
                scope: string;
            };
            expect(token.token_type).toBe("Bearer");
            expect(token.refresh_token).toBeTruthy();

            const verified = await verifyOAuthAccessToken(
                {
                    oauthResourceClient,
                    issuer: authBaseUrl,
                    audiences: [resourceUrl],
                },
                token.access_token,
            );
            expect(verified).toMatchObject({
                status: "authenticated",
                identity: {
                    method: "oauth",
                    clientId: client.client_id,
                    scopes: ["openid", "offline_access", "api.read"],
                    audiences: [resourceUrl],
                },
            });

            const refreshResponse = await exchange(authBaseUrl, {
                grant_type: "refresh_token",
                refresh_token: token.refresh_token,
                client_id: client.client_id,
                resource: resourceUrl,
            });
            expect(refreshResponse.status).toBe(200);
            const refreshed = (await refreshResponse.json()) as {
                access_token: string;
            };
            expect(refreshed.access_token).toBeTruthy();
            await expect(
                verifyOAuthAccessToken(
                    {
                        oauthResourceClient,
                        issuer: authBaseUrl,
                        audiences: [resourceUrl],
                    },
                    refreshed.access_token,
                ),
            ).resolves.toMatchObject({ status: "authenticated" });

            const protectedResource = await fetch(
                `${baseUrl}/.well-known/oauth-protected-resource/mcp`,
            );
            expect(protectedResource.status).toBe(200);
            await expect(protectedResource.json()).resolves.toMatchObject({
                resource: resourceUrl,
                authorization_servers: [authBaseUrl],
                scopes_supported: ["api.read"],
            });
            const authorizationMetadata = await fetch(
                `${baseUrl}/.well-known/oauth-authorization-server/api/auth`,
            );
            expect(authorizationMetadata.status).toBe(200);
            await expect(authorizationMetadata.json()).resolves.toMatchObject({
                issuer: authBaseUrl,
            });

            const dcr = await fetch(`${authBaseUrl}/oauth2/register`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    client_name: "Untrusted dynamic client",
                    redirect_uris: ["https://client.example.com/callback"],
                }),
            });
            expect(dcr.status).toBeGreaterThanOrEqual(400);

            const badProof = pkce();
            const badCode = await authorize(
                authBaseUrl,
                cookie,
                client.client_id,
                redirectUri,
                badProof.challenge,
            );
            const badVerifier = await exchange(authBaseUrl, {
                grant_type: "authorization_code",
                code: badCode,
                redirect_uri: redirectUri,
                client_id: client.client_id,
                code_verifier: `${badProof.verifier}wrong`,
                resource: resourceUrl,
            });
            expect(badVerifier.status).toBeGreaterThanOrEqual(400);

            const wrongRedirectQuery = new URLSearchParams({
                client_id: client.client_id,
                redirect_uri: "com.example.attacker:/callback",
                response_type: "code",
                scope: "openid api.read",
                code_challenge: pkce().challenge,
                code_challenge_method: "S256",
            });
            const wrongRedirect = await fetch(
                `${authBaseUrl}/oauth2/authorize?${wrongRedirectQuery}`,
                { headers: { cookie }, redirect: "manual" },
            );
            const wrongRedirectBody = (await wrongRedirect.json()) as {
                url?: string;
            };
            expect(wrongRedirectBody.url).toContain("error=invalid_redirect");
            expect(wrongRedirectBody.url).not.toContain("example.attacker");

            const logout = await auth.api.signOut({
                headers: new Headers({ cookie }),
                asResponse: true,
            });
            expect(logout.status).toBe(200);
            await expect(
                resolveBetterAuthSession(
                    { auth, issuer: authBaseUrl },
                    new Headers({ cookie }),
                ),
            ).resolves.toEqual({ status: "missing" });
        });
    }, 30_000);

    it("allows unauthenticated DCR only in an explicitly opted-in deployment", async () => {
        const app = express();
        let auth!: ReturnType<typeof createTestAuth>;
        app.use((request, response, next) => {
            if (!request.path.startsWith("/api/auth/")) {
                next();
                return;
            }
            return toNodeHandler(auth)(request, response);
        });

        await withHttpServer(app, async (baseUrl) => {
            auth = createTestAuth(baseUrl, true);
            const response = await fetch(
                `${baseUrl}/api/auth/oauth2/register`,
                {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        client_name: "Public MCP client",
                        redirect_uris: [
                            "https://mcp-client.example.com/callback",
                        ],
                        token_endpoint_auth_method: "none",
                        grant_types: ["authorization_code", "refresh_token"],
                        response_types: ["code"],
                        scope: "openid api.read",
                    }),
                },
            );
            expect(response.status).toBe(201);
            const client = (await response.json()) as {
                client_id: string;
                client_secret?: string;
                token_endpoint_auth_method: string;
            };
            expect(client.client_id).toBeTruthy();
            expect(client.client_secret).toBeUndefined();
            expect(client.token_endpoint_auth_method).toBe("none");

            const excessiveScopes = await fetch(
                `${baseUrl}/api/auth/oauth2/register`,
                {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        client_name: "Over-privileged client",
                        redirect_uris: [
                            "https://mcp-client.example.com/callback",
                        ],
                        token_endpoint_auth_method: "none",
                        grant_types: ["authorization_code"],
                        response_types: ["code"],
                        scope: "openid admin:all",
                    }),
                },
            );
            expect(excessiveScopes.status).toBeGreaterThanOrEqual(400);
        });
    }, 30_000);
});
