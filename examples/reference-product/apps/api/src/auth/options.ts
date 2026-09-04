import { emailOTP } from "better-auth/plugins/email-otp";
import { jwt } from "better-auth/plugins/jwt";
import { oauthProvider } from "@better-auth/oauth-provider";
import { createOAuthProviderOptions } from "@codelitdev/oauth-server-kit/better-auth";

export const AUTH_BASE_PATH = "/api/auth";
export const AUTH_SECRET_MIN_LENGTH = 32;

export type ReferenceAuthUrls = {
    publicApiUrl: string;
    webOrigin: string;
};

export function authUrls(publicApiUrl: string, webOrigin?: string): ReferenceAuthUrls & {
    issuer: string;
    restResource: string;
    mcpResource: string;
} {
    const normalized = publicApiUrl.replace(/\/$/, "");
    return {
        publicApiUrl: normalized,
        webOrigin: (webOrigin ?? normalized).replace(/\/$/, ""),
        issuer: `${normalized}${AUTH_BASE_PATH}`,
        restResource: `${normalized}/api`,
        mcpResource: `${normalized}/mcp`,
    };
}

export function oauthProviderInput(urls: ReturnType<typeof authUrls>) {
    return createOAuthProviderOptions({
        loginPage: `${urls.publicApiUrl}/oauth/login`,
        consentPage: `${urls.publicApiUrl}/oauth/consent`,
        scopes: ["openid", "profile", "email", "offline_access", "data:read"],
        validAudiences: [urls.restResource, urls.mcpResource],
        clientRegistrationDefaultScopes: ["openid", "profile", "email"],
        clientRegistrationAllowedScopes: ["offline_access", "data:read"],
    });
}

/** Shared Better Auth options used by the live factory and the schema generator. */
export function referenceAuthOptions(input: {
    publicApiUrl: string;
    secret: string;
    webOrigin?: string;
    database?: unknown;
}) {
    const urls = authUrls(input.publicApiUrl, input.webOrigin);
    return {
        appName: "Reference Product",
        baseURL: urls.publicApiUrl,
        basePath: AUTH_BASE_PATH,
        secret: input.secret,
        trustedOrigins: [urls.webOrigin, urls.publicApiUrl],
        emailAndPassword: { enabled: true },
        ...(input.database ? { database: input.database } : {}),
        plugins: [
            jwt(),
            emailOTP({
                async sendVerificationOTP() {
                    /* Product mail is application-owned; OTP still issues locally. */
                },
            }),
            oauthProvider(oauthProviderInput(urls)),
        ],
    };
}
