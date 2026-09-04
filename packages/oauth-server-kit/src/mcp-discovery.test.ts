import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withHttpServer } from "../test/http";
import {
    createMcpOAuthDiscoveryRoutes,
    type CreateMcpOAuthDiscoveryRoutesOptions,
} from "./mcp-discovery";
import type { OAuthResourceClient } from "./types";

const authMetadataHandler = vi.fn(
    async () =>
        new Response(
            JSON.stringify({ issuer: "https://auth.example.com/api/auth" }),
            {
                status: 200,
                headers: {
                    "content-type": "application/json",
                    "x-source": "auth",
                },
            },
        ),
);
const oidcMetadataHandler = vi.fn(
    async () =>
        new Response(
            JSON.stringify({ issuer: "https://auth.example.com/api/auth" }),
            {
                status: 201,
                headers: {
                    "content-type": "application/json",
                    "x-source": "oidc",
                },
            },
        ),
);

vi.mock("@better-auth/oauth-provider", () => ({
    oauthProviderAuthServerMetadata: vi.fn(() => authMetadataHandler),
    oauthProviderOpenIdConfigMetadata: vi.fn(() => oidcMetadataHandler),
}));

const metadata = vi.fn(async (overrides: unknown) => ({
    authorization_servers: ["https://auth.example.com/api/auth"],
    ...(overrides as object),
}));

const baseOptions: CreateMcpOAuthDiscoveryRoutesOptions = {
    auth: {
        options: {
            baseURL: "https://auth.example.com",
            basePath: "/api/auth",
        },
        api: {
            getOAuthServerConfig: vi.fn(),
            getOpenIdConfig: vi.fn(),
        },
    },
    oauthResourceClient: {
        id: "oauth-provider-resource-client",
        version: "test",
        getActions: () => ({
            verifyBearerToken: vi.fn(),
            getProtectedResourceMetadata: metadata,
        }),
    } as unknown as OAuthResourceClient,
    resourceUrl: "https://api.example.com/mcp/",
    scopesSupported: ["tools:read", "tools:write", "tools:read", " "],
    allowedOrigins: ["https://app.example.com"],
};

function appFor(overrides: Partial<CreateMcpOAuthDiscoveryRoutesOptions> = {}) {
    const app = express();
    app.use(createMcpOAuthDiscoveryRoutes({ ...baseOptions, ...overrides }));
    return app;
}

describe("createMcpOAuthDiscoveryRoutes", () => {
    afterEach(() => {
        vi.clearAllMocks();
        delete process.env.NODE_ENV;
    });

    it.each([
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-authorization-server/api/auth",
    ])("serves authorization-server metadata at %s", async (path) => {
        await withHttpServer(appFor(), async (baseUrl) => {
            const authorization = await fetch(`${baseUrl}${path}`);
            expect(authorization.status).toBe(200);
            expect(authorization.headers.get("x-source")).toBe("auth");
            await expect(authorization.json()).resolves.toMatchObject({
                issuer: "https://auth.example.com/api/auth",
            });
        });
        expect(authMetadataHandler).toHaveBeenCalledOnce();
    });

    it.each([
        "/.well-known/openid-configuration",
        "/api/auth/.well-known/openid-configuration",
    ])("serves OIDC metadata at %s", async (path) => {
        await withHttpServer(appFor(), async (baseUrl) => {
            const oidc = await fetch(`${baseUrl}${path}`);
            expect(oidc.status).toBe(201);
            expect(oidc.headers.get("x-source")).toBe("oidc");
        });
        expect(oidcMetadataHandler).toHaveBeenCalledOnce();
    });

    it.each([
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
    ])("serves protected-resource metadata at %s", async (path) => {
        await withHttpServer(appFor(), async (baseUrl) => {
            const response = await fetch(`${baseUrl}${path}`);
            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toMatchObject({
                resource: "https://api.example.com/mcp/",
                scopes_supported: ["tools:read", "tools:write"],
                bearer_methods_supported: ["header"],
                authorization_servers: ["https://auth.example.com/api/auth"],
            });
        });
        expect(metadata).toHaveBeenCalledWith(
            {
                resource: "https://api.example.com/mcp/",
                authorization_servers: ["https://auth.example.com/api/auth"],
                scopes_supported: ["tools:read", "tools:write"],
                bearer_methods_supported: ["header"],
            },
        );
    });

    it("allows exact configured CORS origins and answers preflight", async () => {
        await withHttpServer(appFor(), async (baseUrl) => {
            const response = await fetch(
                `${baseUrl}/.well-known/oauth-protected-resource/mcp`,
                {
                    method: "OPTIONS",
                    headers: { origin: "https://app.example.com" },
                },
            );
            expect(response.status).toBe(204);
            expect(response.headers.get("access-control-allow-origin")).toBe(
                "https://app.example.com",
            );
            expect(response.headers.get("vary")).toContain("Origin");
            expect(response.headers.get("access-control-allow-methods")).toBe(
                "GET, OPTIONS",
            );
            expect(response.headers.get("access-control-expose-headers")).toBe(
                "Mcp-Session-Id",
            );
        });
    });

    it("rejects an untrusted browser origin", async () => {
        await withHttpServer(appFor(), async (baseUrl) => {
            const response = await fetch(
                `${baseUrl}/.well-known/oauth-protected-resource`,
                { headers: { origin: "https://evil.example.com" } },
            );
            expect(response.status).toBe(403);
            await expect(response.json()).resolves.toEqual({
                error: "origin_not_allowed",
            });
        });
    });

    it("supports wildcard discovery CORS without reflecting credentials", async () => {
        await withHttpServer(
            appFor({ allowedOrigins: "*" }),
            async (baseUrl) => {
                const response = await fetch(
                    `${baseUrl}/.well-known/oauth-protected-resource`,
                    { headers: { origin: "https://any.example.com" } },
                );
                expect(
                    response.headers.get("access-control-allow-origin"),
                ).toBe("*");
                expect(
                    response.headers.get("access-control-allow-credentials"),
                ).toBeNull();
            },
        );
    });

    it("does not intercept unrelated application routes or preflights", async () => {
        const app = appFor();
        app.options("/unrelated", (_request, response) =>
            response.status(299).end(),
        );
        app.get("/unrelated", (_request, response) =>
            response.json({ ok: true }),
        );
        await withHttpServer(app, async (baseUrl) => {
            expect((await fetch(`${baseUrl}/unrelated`)).status).toBe(200);
            expect(
                (
                    await fetch(`${baseUrl}/unrelated`, {
                        method: "OPTIONS",
                        headers: { origin: "https://evil.example.com" },
                    })
                ).status,
            ).toBe(299);
        });
    });

    it("forwards async metadata failures to the consuming Express error handler", async () => {
        metadata.mockRejectedValueOnce(new Error("metadata unavailable"));
        const app = appFor();
        app.use(
            (
                error: Error,
                _request: express.Request,
                response: express.Response,
                _next: express.NextFunction,
            ) => response.status(503).json({ error: error.message }),
        );
        await withHttpServer(app, async (baseUrl) => {
            const response = await fetch(
                `${baseUrl}/.well-known/oauth-protected-resource`,
            );
            expect(response.status).toBe(503);
            await expect(response.json()).resolves.toEqual({
                error: "metadata unavailable",
            });
        });
    });

    it("supports an authorization server mounted at the origin root", async () => {
        await withHttpServer(
            appFor({
                auth: {
                    options: {
                        baseURL: "https://auth.example.com",
                        basePath: "/",
                    },
                    api: baseOptions.auth.api,
                },
            }),
            async (baseUrl) => {
                expect(
                    (
                        await fetch(
                            `${baseUrl}/.well-known/oauth-protected-resource`,
                        )
                    ).status,
                ).toBe(200);
            },
        );
        expect(metadata).toHaveBeenCalledWith(
            expect.objectContaining({
                authorization_servers: ["https://auth.example.com"],
            }),
        );
    });

    it.each([
        [{ resourceUrl: "relative" }, "resourceUrl must be an absolute URL"],
        [
            { resourceUrl: "file:///tmp/resource" },
            "resourceUrl must use http or https",
        ],
        [
            { resourceUrl: "https://api.example.com/mcp?tenant=1" },
            "resourceUrl must not include credentials, query, or fragment",
        ],
        [{ allowedOrigins: [] }, "allowedOrigins must not be empty"],
        [
            { allowedOrigins: ["relative"] },
            "allowedOrigins must contain absolute origins",
        ],
        [
            { allowedOrigins: ["file:///tmp"] },
            "allowedOrigins must use http or https",
        ],
        [
            { allowedOrigins: ["https://app.example.com/path"] },
            "allowedOrigins must contain origins without paths",
        ],
        [
            { auth: { options: {}, api: baseOptions.auth.api } },
            "auth.options.baseURL must be configured",
        ],
        [
            {
                auth: {
                    options: { baseURL: "relative" },
                    api: baseOptions.auth.api,
                },
            },
            "auth.options.baseURL must be an absolute URL",
        ],
        [
            {
                auth: {
                    options: { baseURL: "file:///tmp" },
                    api: baseOptions.auth.api,
                },
            },
            "auth.options.baseURL must use http or https",
        ],
        [
            {
                auth: {
                    options: { baseURL: "https://auth.example.com/base" },
                    api: baseOptions.auth.api,
                },
            },
            "auth.options.baseURL must be an origin URL",
        ],
        [
            {
                auth: {
                    options: {
                        baseURL: "https://auth.example.com",
                        basePath: "api/auth",
                    },
                    api: baseOptions.auth.api,
                },
            },
            "auth.options.basePath must be an absolute path",
        ],
    ])("rejects invalid discovery configuration", (override, message) => {
        expect(() =>
            appFor(override as Partial<CreateMcpOAuthDiscoveryRoutesOptions>),
        ).toThrow(message);
    });

    it("requires HTTPS resource identifiers in production", () => {
        process.env.NODE_ENV = "production";
        expect(() =>
            appFor({ resourceUrl: "http://api.example.com/mcp" }),
        ).toThrow("resourceUrl must use https in production");
    });

    it("requires HTTPS authorization server and allowed origins in production", () => {
        process.env.NODE_ENV = "production";
        expect(() =>
            appFor({
                auth: {
                    options: { baseURL: "http://auth.example.com" },
                    api: baseOptions.auth.api,
                },
            }),
        ).toThrow("auth.options.baseURL must use https in production");
        expect(() =>
            appFor({ allowedOrigins: ["http://app.example.com"] }),
        ).toThrow("allowedOrigins must use https in production");
    });
});
