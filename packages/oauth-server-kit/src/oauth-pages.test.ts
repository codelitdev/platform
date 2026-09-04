import express from "express";
import { describe, expect, it } from "vitest";
import { withHttpServer } from "../test/http";
import {
    createOAuthPagesRouter,
    type CreateOAuthPagesRouterOptions,
} from "./oauth-pages";

const options: CreateOAuthPagesRouterOptions = {
    appName: "Test <Product>",
    authBasePath: "/custom/auth/",
    allowedRedirectOrigins: ["https://app.example.com"],
    defaultRedirectUrl: "https://app.example.com/home",
    loginMethods: [
        { type: "email-otp", label: "Email & code" },
        { type: "social", providerId: "github", label: "Continue with GitHub" },
    ],
    legacyHostOnlySessionCookieNames: [
        "__Secure-better-auth.session_token",
        "better-auth.session_data",
    ],
};

function pagesApp(overrides: Partial<CreateOAuthPagesRouterOptions> = {}) {
    const app = express();
    app.use(createOAuthPagesRouter({ ...options, ...overrides }));
    return app;
}

describe("createOAuthPagesRouter", () => {
    it("renders configured email and social login using the custom auth path", async () => {
        await withHttpServer(pagesApp(), async (baseUrl) => {
            const response = await fetch(
                `${baseUrl}/login?redirect=${encodeURIComponent("https://app.example.com/settings?tab=profile")}`,
                { redirect: "manual" },
            );
            const html = await response.text();
            expect(response.status).toBe(200);
            expect(response.headers.get("content-security-policy")).toBe(
                "frame-ancestors 'none'",
            );
            expect(response.headers.get("x-frame-options")).toBe("DENY");
            expect(response.headers.get("x-content-type-options")).toBe(
                "nosniff",
            );
            expect(html).toContain("Test &lt;Product&gt;");
            expect(html).toContain('<div class="logo">T</div>');
            expect(html).not.toContain("<img ");
            expect(html).not.toContain('rel="icon"');
            expect(html).toContain("Email &amp; code");
            expect(html).toContain("Email address");
            expect(html).toContain("Continue with GitHub");
            expect(html).toContain('data-provider="github"');
            expect(html).toContain('viewBox="0 0 16 16"');
            expect(html).not.toContain(
                "Use one of the configured sign-in methods.",
            );
            expect(html).toContain('var authBasePath="/custom/auth"');
            expect(html).toContain(
                "https://app.example.com/settings?tab=profile",
            );
            expect(html).toContain(
                "function follow(data){var target=data.url||data.redirect_uri||redirectTarget;",
            );
            expect(html).not.toContain(
                "var target=oauth?(data.url||data.redirect_uri):redirectTarget",
            );
            expect(response.headers.getSetCookie()).toHaveLength(2);
            expect(response.headers.getSetCookie().join("\n")).toContain(
                "Max-Age=0",
            );
        });
    });

    it("falls back from a malicious or malformed ordinary-login redirect", async () => {
        for (const redirect of ["https://evil.example/phish", "not-a-url"]) {
            await withHttpServer(pagesApp(), async (baseUrl) => {
                const response = await fetch(
                    `${baseUrl}/login?redirect=${encodeURIComponent(redirect)}`,
                );
                const html = await response.text();
                expect(html).toContain("https://app.example.com/home");
                expect(html).not.toContain("evil.example");
            });
        }
    });

    it("renders OAuth login without an ordinary redirect and clears legacy cookies", async () => {
        await withHttpServer(pagesApp(), async (baseUrl) => {
            const response = await fetch(
                `${baseUrl}/oauth/login?client_id=client_1`,
            );
            const html = await response.text();
            expect(html).toContain("var oauth=true");
            expect(html).toContain("oauthQuery=location.search.slice(1)");
            expect(response.headers.getSetCookie()).toHaveLength(2);
        });
    });

    it("renders only explicitly configured methods", async () => {
        await withHttpServer(
            pagesApp({ loginMethods: [{ type: "email-otp" }] }),
            async (baseUrl) => {
                const html = await (await fetch(`${baseUrl}/login`)).text();
                expect(html).toContain("Continue with email");
                expect(html).not.toContain("Continue with GitHub");
                expect(html).not.toContain('class="divider"');
            },
        );
        await withHttpServer(
            pagesApp({
                loginMethods: [
                    {
                        type: "social",
                        providerId: "google",
                        label: "Google only",
                    },
                ],
            }),
            async (baseUrl) => {
                const html = await (await fetch(`${baseUrl}/login`)).text();
                expect(html).toContain("Google only");
                expect(html).toContain('fill="#4285F4"');
                expect(html).toContain('data-provider="google"');
                expect(html).not.toContain('id="email-form"');
                expect(html).not.toContain(
                    "Use one of the configured sign-in methods.",
                );
            },
        );
    });

    it("escapes consent client and scope display values and posts both decisions", async () => {
        await withHttpServer(pagesApp(), async (baseUrl) => {
            const query = new URLSearchParams({
                client_id: '<script>alert("x")</script>',
                scope: 'read <img/src=x> "admin"',
            });
            const response = await fetch(`${baseUrl}/oauth/consent?${query}`);
            const html = await response.text();
            expect(html).not.toContain("<script>alert");
            expect(html).toContain(
                "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
            );
            expect(html).toContain("&lt;img/src=x&gt;");
            expect(html).toContain('authBasePath="/custom/auth"');
            expect(html).toContain("decide(true)");
            expect(html).toContain("decide(false)");
            expect(response.headers.get("x-frame-options")).toBe("DENY");
        });
    });

    it.each([
        [{ appName: " " }, "appName is required"],
        [{ authBasePath: "api/auth" }, "authBasePath must be an absolute path"],
        [
            { authBasePath: "//evil.example.com" },
            "authBasePath must be an absolute path",
        ],
        [
            { authBasePath: "/api/auth?x=1" },
            "authBasePath must be an absolute path",
        ],
        [
            { authBasePath: "/api/auth path" },
            "authBasePath must be an absolute path",
        ],
        [
            { allowedRedirectOrigins: [] },
            "allowedRedirectOrigins must not be empty",
        ],
        [
            { allowedRedirectOrigins: ["relative"] },
            "allowedRedirectOrigins must be an absolute URL",
        ],
        [
            { allowedRedirectOrigins: ["file:///tmp"] },
            "allowedRedirectOrigins must use http or https",
        ],
        [
            { allowedRedirectOrigins: ["https://app.example.com/path"] },
            "allowedRedirectOrigins must contain origins without paths",
        ],
        [
            { defaultRedirectUrl: "relative" },
            "defaultRedirectUrl must be an absolute URL",
        ],
        [
            { defaultRedirectUrl: "https://elsewhere.example.com" },
            "defaultRedirectUrl must use an allowed origin",
        ],
        [{ loginMethods: [] }, "loginMethods must contain at least one method"],
        [
            { loginMethods: [{ type: "email-otp" }, { type: "email-otp" }] },
            "loginMethods must have unique method identifiers",
        ],
        [
            {
                loginMethods: [
                    { type: "social", providerId: "", label: "Provider" },
                ],
            },
            "social login methods require providerId and label",
        ],
        [
            { legacyHostOnlySessionCookieNames: ["bad cookie"] },
            "legacy cookie names contain invalid characters",
        ],
        [{ logoUrl: "javascript:alert(1)" }, "logoUrl must use http or https"],
        [
            { logoUrl: "data:image/svg+xml,<svg>" },
            "logoUrl must use http or https",
        ],
        [{ logoUrl: "relative.svg" }, "logoUrl must be an absolute URL"],
        [
            { faviconUrl: "https://user:pass@cdn.example.com/icon.png" },
            "faviconUrl must not contain credentials",
        ],
        [
            { primaryColor: "red" },
            "primaryColor must be a hex or oklch() color",
        ],
        [
            { primaryColor: "#8c7a6b;background:url(x)" },
            "primaryColor must be a hex or oklch() color",
        ],
    ])("rejects unsafe hosted-page configuration", (override, message) => {
        expect(() =>
            pagesApp(override as Partial<CreateOAuthPagesRouterOptions>),
        ).toThrow(message);
    });

    it("renders optional product branding on login and consent", async () => {
        await withHttpServer(
            pagesApp({
                logoUrl: "https://cdn.example.com/logo.svg",
                faviconUrl: "/icon.svg",
                primaryColor: "oklch(0.47 0.14 150)",
            }),
            async (baseUrl) => {
                const login = await (await fetch(`${baseUrl}/login`)).text();
                expect(login).toContain(
                    '<div class="logo has-image"><img src="https://cdn.example.com/logo.svg" alt="Test &lt;Product&gt;"></div>',
                );
                expect(login).not.toContain('<div class="logo">T</div>');
                expect(login).toContain('<link rel="icon" href="/icon.svg">');
                expect(login).toContain(
                    "html{--brand-primary:oklch(0.47 0.14 150)}",
                );
                const consent = await (
                    await fetch(`${baseUrl}/oauth/consent`)
                ).text();
                expect(consent).toContain(
                    'src="https://cdn.example.com/logo.svg"',
                );
                expect(consent).toContain('rel="icon"');
            },
        );
    });

    it("supports Better Auth mounted at the origin root", async () => {
        await withHttpServer(
            pagesApp({ authBasePath: "/" }),
            async (baseUrl) => {
                const html = await (await fetch(`${baseUrl}/login`)).text();
                expect(html).toContain('var authBasePath=""');
                expect(html).toContain(
                    'post("/email-otp/send-verification-otp"',
                );
            },
        );
    });
});
