import { describe, expect, it, vi } from "vitest";
import { verifyOAuthAccessToken } from "./verify-access-token";
import type { OAuthResourceClient } from "./types";

function resourceClient(claims: unknown, rejects = false): OAuthResourceClient {
    const verifyBearerToken = rejects
        ? vi.fn().mockRejectedValue(claims)
        : vi.fn().mockResolvedValue(claims);
    return {
        id: "oauth-provider-resource-client",
        version: "test",
        getActions: () => ({
            verifyBearerToken,
            getProtectedResourceMetadata: vi.fn(),
        }),
    } as unknown as OAuthResourceClient;
}

const baseOptions = {
    issuer: "https://auth.example.com/",
    audiences: ["https://api.example.com", "https://api.example.com"],
};

describe("verifyOAuthAccessToken", () => {
    it("returns a normalized neutral OAuth identity", async () => {
        const oauthResourceClient = resourceClient({
            sub: "user_1",
            iss: "https://auth.example.com",
            azp: "mobile_1",
            aud: ["https://api.example.com", "https://elsewhere.example.com"],
            scope: "read  write read",
            email: "person@example.com",
            name: "Person",
            team_id: "must-not-leak",
            role: "owner",
        });

        const result = await verifyOAuthAccessToken(
            { ...baseOptions, oauthResourceClient },
            "signed-token",
        );

        expect(result).toEqual({
            status: "authenticated",
            identity: {
                method: "oauth",
                issuer: "https://auth.example.com",
                subject: "user_1",
                email: "person@example.com",
                name: "Person",
                clientId: "mobile_1",
                scopes: ["read", "write"],
                audiences: ["https://api.example.com"],
            },
        });
        expect(JSON.stringify(result)).not.toContain("team_id");
        expect(JSON.stringify(result)).not.toContain("owner");
    });

    it("supports client_id, string audience, and array scopes", async () => {
        const oauthResourceClient = resourceClient({
            sub: "user_2",
            iss: "https://auth.example.com/",
            client_id: "rest_client",
            aud: "https://api.example.com",
            scope: ["read", "", 42, "read"],
            email: "",
            name: 123,
        });
        const result = await verifyOAuthAccessToken(
            { ...baseOptions, oauthResourceClient },
            "token",
        );
        expect(result).toMatchObject({
            status: "authenticated",
            identity: {
                clientId: "rest_client",
                scopes: ["read"],
                audiences: ["https://api.example.com"],
            },
        });
        expect(result).not.toHaveProperty("identity.email");
        expect(result).not.toHaveProperty("identity.name");
    });

    it.each([
        [
            {
                iss: "https://auth.example.com",
                azp: "c",
                aud: "https://api.example.com",
            },
        ],
        [{ sub: "u", azp: "c", aud: "https://api.example.com" }],
        [
            {
                sub: "u",
                iss: "https://wrong.example.com",
                azp: "c",
                aud: "https://api.example.com",
            },
        ],
        [
            {
                sub: "u",
                iss: "https://auth.example.com",
                aud: "https://api.example.com",
            },
        ],
        [
            {
                sub: "u",
                iss: "https://auth.example.com",
                azp: "c",
                aud: "https://wrong.example.com",
            },
        ],
        [{ sub: "u", iss: "https://auth.example.com", azp: "c", aud: 42 }],
    ])("fails closed for incomplete or mismatched claims", async (claims) => {
        const result = await verifyOAuthAccessToken(
            { ...baseOptions, oauthResourceClient: resourceClient(claims) },
            "token",
        );
        expect(result).toEqual({ status: "invalid_token" });
    });

    it("fails closed when Better Auth rejects the token", async () => {
        const result = await verifyOAuthAccessToken(
            {
                ...baseOptions,
                oauthResourceClient: resourceClient(new Error("expired"), true),
                resourceMetadataMappings: { api: "https://api.example.com" },
            },
            "token",
        );
        expect(result).toEqual({ status: "invalid_token" });
    });

    it("rejects empty tokens without calling the verifier", async () => {
        const oauthResourceClient = resourceClient({});
        expect(
            await verifyOAuthAccessToken(
                { ...baseOptions, oauthResourceClient },
                "   ",
            ),
        ).toEqual({ status: "invalid_token" });
        expect(
            oauthResourceClient.getActions().verifyBearerToken,
        ).not.toHaveBeenCalled();
    });

    it.each([
        [
            "not-a-url",
            ["https://api.example.com"],
            "issuer must be an absolute URL",
        ],
        [
            "ftp://auth.example.com",
            ["https://api.example.com"],
            "issuer must use http or https",
        ],
        [
            "https://auth.example.com",
            ["", "  "],
            "audiences must contain at least one value",
        ],
    ])(
        "validates verifier configuration",
        async (issuer, audiences, message) => {
            await expect(
                verifyOAuthAccessToken(
                    {
                        issuer,
                        audiences,
                        oauthResourceClient: resourceClient({}),
                    },
                    "token",
                ),
            ).rejects.toThrow(message);
        },
    );

    it("validates metadata mappings and production HTTPS", async () => {
        await expect(
            verifyOAuthAccessToken(
                {
                    ...baseOptions,
                    oauthResourceClient: resourceClient({}),
                    resourceMetadataMappings: { api: "relative" },
                },
                "token",
            ),
        ).rejects.toThrow("resourceMetadataMappings must be an absolute URL");

        process.env.NODE_ENV = "production";
        try {
            await expect(
                verifyOAuthAccessToken(
                    {
                        issuer: "http://auth.example.com",
                        audiences: ["https://api.example.com"],
                        oauthResourceClient: resourceClient({}),
                    },
                    "token",
                ),
            ).rejects.toThrow("issuer must use https in production");
        } finally {
            delete process.env.NODE_ENV;
        }
    });
});
