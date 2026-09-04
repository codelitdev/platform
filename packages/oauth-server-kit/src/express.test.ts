import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withHttpServer } from "../test/http";
import { createOAuthBearerMiddleware } from "./express";
import { verifyOAuthAccessToken } from "./verify-access-token";

vi.mock("./verify-access-token", async (importOriginal) => {
    const original =
        await importOriginal<typeof import("./verify-access-token")>();
    return { ...original, verifyOAuthAccessToken: vi.fn() };
});

const mockedVerify = vi.mocked(verifyOAuthAccessToken);
const middlewareOptions = {
    issuer: "https://auth.example.com",
    audiences: ["https://api.example.com"],
    oauthResourceClient: {} as never,
};

function testApp(resourceMetadataUrl?: string) {
    const app = express();
    app.get(
        "/protected",
        createOAuthBearerMiddleware({
            ...middlewareOptions,
            ...(resourceMetadataUrl ? { resourceMetadataUrl } : {}),
        }),
        (request, response) => response.json({ auth: request.auth }),
    );
    return app;
}

describe("createOAuthBearerMiddleware", () => {
    beforeEach(() => mockedVerify.mockReset());

    it.each([undefined, "Basic abc", "Bearer   "])(
        "returns the documented missing-credential response",
        async (authorization) => {
            await withHttpServer(testApp(), async (baseUrl) => {
                const response = await fetch(`${baseUrl}/protected`, {
                    headers: authorization ? { authorization } : {},
                });
                expect(response.status).toBe(401);
                expect(response.headers.get("www-authenticate")).toBe("Bearer");
                await expect(response.json()).resolves.toEqual({
                    error: "unauthorized",
                    error_description: "A Bearer access token is required",
                });
            });
            expect(mockedVerify).not.toHaveBeenCalled();
        },
    );

    it("adds MCP protected-resource discovery to the challenge", async () => {
        const metadata =
            "https://api.example.com/.well-known/oauth-protected-resource/mcp";
        await withHttpServer(testApp(metadata), async (baseUrl) => {
            const response = await fetch(`${baseUrl}/protected`);
            expect(response.headers.get("www-authenticate")).toBe(
                `Bearer resource_metadata="${metadata}"`,
            );
        });
    });

    it("fails closed for an invalid explicit bearer", async () => {
        mockedVerify.mockResolvedValue({ status: "invalid_token" });
        await withHttpServer(testApp(), async (baseUrl) => {
            const response = await fetch(`${baseUrl}/protected`, {
                headers: { authorization: "bearer bad-token" },
            });
            expect(response.status).toBe(401);
            await expect(response.json()).resolves.toEqual({
                error: "invalid_token",
                error_description: "The access token is invalid or expired",
            });
        });
        expect(mockedVerify).toHaveBeenCalledWith(
            middlewareOptions,
            "bad-token",
        );
    });

    it("returns 503 without exposing the verifier cause", async () => {
        mockedVerify.mockResolvedValue({
            status: "unavailable",
            cause: new Error("secret database detail"),
        });
        await withHttpServer(testApp(), async (baseUrl) => {
            const response = await fetch(`${baseUrl}/protected`, {
                headers: { authorization: "Bearer token" },
            });
            expect(response.status).toBe(503);
            expect(response.headers.get("www-authenticate")).toBeNull();
            await expect(response.json()).resolves.toEqual({
                error: "authentication_unavailable",
            });
        });
    });

    it("populates req.auth and continues to the product handler", async () => {
        const identity = {
            method: "oauth" as const,
            issuer: "https://auth.example.com",
            subject: "user_1",
            clientId: "client_1",
            scopes: ["read"],
            audiences: ["https://api.example.com"],
        };
        mockedVerify.mockResolvedValue({ status: "authenticated", identity });
        await withHttpServer(testApp(), async (baseUrl) => {
            const response = await fetch(`${baseUrl}/protected`, {
                headers: { authorization: "Bearer good-token" },
            });
            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ auth: identity });
        });
    });

    it.each([
        ["relative", "resourceMetadataUrl must be an absolute URL"],
        ["file:///tmp/metadata", "resourceMetadataUrl must use http or https"],
    ])("rejects invalid challenge configuration at startup", (url, message) => {
        expect(() => testApp(url)).toThrow(message);
    });

    it("rejects insecure production challenge URLs at startup", () => {
        process.env.NODE_ENV = "production";
        try {
            expect(() => testApp("http://api.example.com/metadata")).toThrow(
                "resourceMetadataUrl must use https in production",
            );
        } finally {
            delete process.env.NODE_ENV;
        }
    });
});
