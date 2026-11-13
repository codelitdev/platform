import { oauthProvider } from "@better-auth/oauth-provider";
import {
  createOAuthProviderOptions,
  secureCookieOptions,
  secureEmailAndPasswordOptions,
  secureSessionOptions,
  sessionCookieName,
} from "@codelitdev/oauth-server-kit/better-auth";
import { emailOTP } from "better-auth/plugins/email-otp";
import { jwt } from "better-auth/plugins/jwt";

export const AUTH_BASE_PATH = "/api/auth";
export const AUTH_COOKIE_PREFIX = "reference-product";
export const AUTH_SECRET_MIN_LENGTH = 32;

export const DATA_READ_SCOPE = "data:read";
export const DATA_WRITE_SCOPE = "data:write";
// MCP clients request exactly these. `offline_access` gets them a refresh
// token instead of a new consent every time the access token expires.
export const MCP_SCOPES_SUPPORTED = [
  DATA_READ_SCOPE,
  DATA_WRITE_SCOPE,
  "offline_access",
] as const;

/** Better Auth's `advanced` cookie options, plus the session cookie name they produce. */
export function authCookieOptions(publicApiUrl: string) {
  const advanced = secureCookieOptions({
    baseURL: publicApiUrl,
    cookiePrefix: AUTH_COOKIE_PREFIX,
  });
  return { advanced, sessionCookieName: sessionCookieName(advanced) };
}

export type ReferenceAuthUrls = {
  publicApiUrl: string;
  webOrigin: string;
};

export function authUrls(
  publicApiUrl: string,
  webOrigin?: string,
): ReferenceAuthUrls & {
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
    scopes: [
      "openid",
      "profile",
      "email",
      "offline_access",
      DATA_READ_SCOPE,
      DATA_WRITE_SCOPE,
    ],
    validAudiences: [urls.restResource, urls.mcpResource],
    allowDynamicClientRegistration: true,
    allowUnauthenticatedDynamicClientRegistration: true,
    clientRegistrationDefaultScopes: ["openid", "profile", "email"],
    clientRegistrationAllowedScopes: [
      "offline_access",
      DATA_READ_SCOPE,
      DATA_WRITE_SCOPE,
    ],
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
    // `__Host-` session cookie over https; each product keeps its own prefix.
    advanced: { ...authCookieOptions(urls.publicApiUrl).advanced },
    // No cookie cache: a revoked session stops working immediately.
    session: secureSessionOptions(),
    trustedOrigins: [urls.webOrigin, urls.publicApiUrl],
    emailAndPassword: secureEmailAndPasswordOptions(),
    ...(input.database ? { database: input.database } : {}),
    plugins: [
      jwt(),
      emailOTP({
        async sendVerificationOTP({ email, otp, type }) {
          if ((process.env.NODE_ENV ?? "development") === "development") {
            console.info(`[auth] ${type} OTP for ${email}: ${otp}`);
          }
        },
      }),
      oauthProvider(oauthProviderInput(urls)),
    ],
  };
}
