import type { OAuthOptions } from "@better-auth/oauth-provider";
import type { AuthenticationResult } from "./types";

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

export interface ResolveBetterAuthSessionOptions {
    auth: BetterAuthSessionApi;
    issuer: string;
}

function normalizeIssuer(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error("issuer must be an absolute URL");
    }
    if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("issuer must use http or https");
    }
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
        throw new Error("issuer must use https in production");
    }
    return url.toString().replace(/\/$/, "");
}

export async function resolveBetterAuthSession(
    options: ResolveBetterAuthSessionOptions,
    headers: Headers,
): Promise<AuthenticationResult> {
    const issuer = normalizeIssuer(options.issuer);
    try {
        const session = await options.auth.api.getSession({ headers });
        if (!session?.user?.id || !session.user.email) {
            return { status: "missing" };
        }
        return {
            status: "authenticated",
            identity: {
                method: "session",
                issuer,
                subject: session.user.id,
                email: session.user.email,
                name: session.user.name,
                scopes: [],
            },
        };
    } catch (cause) {
        return { status: "unavailable", cause };
    }
}

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

function uniqueRequired(values: readonly string[], field: string): string[] {
    const result = [
        ...new Set(values.map((value) => value.trim()).filter(Boolean)),
    ];
    if (result.length === 0) {
        throw new Error(`${field} must contain at least one value`);
    }
    return result;
}

function assertPageLocation(value: string, field: string) {
    if (value.startsWith("/") && !value.startsWith("//")) {
        if (/\s/.test(value)) {
            throw new Error(
                `${field} must be an absolute URL or absolute path`,
            );
        }
        return;
    }
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`${field} must be an absolute URL or absolute path`);
    }
    if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error(`${field} must use http or https`);
    }
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
        throw new Error(`${field} must use https in production`);
    }
}

function assertScopeSubset(
    values: readonly string[] | undefined,
    scopes: readonly string[],
    field: string,
): string[] | undefined {
    if (!values) return undefined;
    const normalized = [
        ...new Set(values.map((value) => value.trim()).filter(Boolean)),
    ];
    const invalid = normalized.filter((scope) => !scopes.includes(scope));
    if (invalid.length > 0) {
        throw new Error(
            `${field} contains unsupported scopes: ${invalid.join(", ")}`,
        );
    }
    return normalized;
}

export function createOAuthProviderOptions(
    input: CreateOAuthProviderOptionsInput,
): OAuthOptions<string[]> {
    assertPageLocation(input.loginPage, "loginPage");
    assertPageLocation(input.consentPage, "consentPage");
    const scopes = uniqueRequired(input.scopes, "scopes");
    const validAudiences = uniqueRequired(
        input.validAudiences,
        "validAudiences",
    );
    if (
        input.allowUnauthenticatedDynamicClientRegistration &&
        !input.allowDynamicClientRegistration
    ) {
        throw new Error(
            "unauthenticated dynamic client registration requires dynamic client registration",
        );
    }
    const clientRegistrationDefaultScopes = assertScopeSubset(
        input.clientRegistrationDefaultScopes,
        scopes,
        "clientRegistrationDefaultScopes",
    );
    const clientRegistrationAllowedScopes = assertScopeSubset(
        input.clientRegistrationAllowedScopes,
        scopes,
        "clientRegistrationAllowedScopes",
    );

    return {
        loginPage: input.loginPage,
        consentPage: input.consentPage,
        scopes,
        resources: validAudiences,
        clientRegistrationDefaultResources: validAudiences,
        clientRegistrationAllowedResources: validAudiences,
        allowDynamicClientRegistration:
            input.allowDynamicClientRegistration ?? false,
        allowUnauthenticatedClientRegistration:
            input.allowUnauthenticatedDynamicClientRegistration ?? false,
        ...(clientRegistrationDefaultScopes
            ? { clientRegistrationDefaultScopes }
            : {}),
        ...(clientRegistrationAllowedScopes
            ? { clientRegistrationAllowedScopes }
            : {}),
    };
}
