export interface SecureCookieOptionsInput {
  /** Public URL Better Auth is served from (its `baseURL`). */
  baseURL: string;
  /** Product-specific prefix, e.g. `courselit`. Must not already carry `__Host-`/`__Secure-`. */
  cookiePrefix: string;
  /** Pass through only when cookies must be shared across sibling subdomains. */
  crossSubDomainCookies?: { enabled: boolean; domain?: string };
  /**
   * Name of an internal header the app's edge sets to the trusted client
   * address (see `createClientIpMiddleware`). Better Auth then reads the
   * address only from it, never from `X-Forwarded-For`.
   */
  clientIpHeader?: string;
}

/** The subset of Better Auth's `advanced` options these helpers produce. */
export interface SecureCookieAdvancedOptions {
  cookiePrefix: string;
  useSecureCookies?: boolean;
  defaultCookieAttributes?: { secure: boolean; path: string };
  crossSubDomainCookies?: { enabled: boolean; domain?: string };
  ipAddress?: { ipAddressHeaders: string[] };
}

const COOKIE_PREFIX_PATTERN = /^[A-Za-z0-9_-]+$/;
const HOST_PREFIX = "__Host-";
const SECURE_PREFIX = "__Secure-";
const SESSION_TOKEN_SUFFIX = ".session_token";

function assertBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("baseURL must be an absolute URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("baseURL must use http or https");
  }
  return url;
}

function assertCookiePrefix(value: string) {
  if (!COOKIE_PREFIX_PATTERN.test(value)) {
    throw new Error(
      "cookiePrefix must be non-empty and contain only letters, digits, '_' or '-'",
    );
  }
  if (value.startsWith(HOST_PREFIX) || value.startsWith(SECURE_PREFIX)) {
    throw new Error(
      "cookiePrefix must not include __Host- or __Secure-; the kit adds it",
    );
  }
}

/**
 * Better Auth `advanced` options for hardened session cookies. Spread them
 * into your own config: `advanced: { ...secureCookieOptions({...}) }`.
 *
 * - https, no cross-subdomain cookies: the session cookie is
 *   `__Host-<prefix>.session_token` (Secure, `Path=/`, no `Domain`), so a
 *   sibling subdomain cannot plant or shadow it. Better Auth only knows
 *   `__Secure-` and would produce `__Secure-__Host-...`, so `__Host-` is
 *   folded into `cookiePrefix` and Secure is set via `defaultCookieAttributes`.
 * - https with cross-subdomain cookies: `__Host-` forbids `Domain`, so the
 *   cookie keeps Better Auth's `__Secure-` prefix and is shared as configured.
 * - http (local development): plain `<prefix>.session_token`.
 *
 * Known limitation: `@better-auth/oauth-provider` stores a short-lived
 * RP-initiated-logout confirmation cookie named
 * `<session cookie name>.oauth_logout_confirmation` on the path
 * `/api/auth/oauth2/end-session/confirm`. Browsers reject a `__Host-` cookie
 * with any path but `/`, so that cookie is dropped under `__Host-` and the
 * logout confirmation step (shown when an OAuth client calls end-session
 * without a valid `id_token_hint`) cannot complete. Neither the plugin's
 * options nor `advanced.cookies` can change its name or path. Products that
 * need that flow must use cross-subdomain mode (`__Secure-`) or accept it.
 */
export function secureCookieOptions(
  input: SecureCookieOptionsInput,
): SecureCookieAdvancedOptions {
  const url = assertBaseUrl(input.baseURL);
  assertCookiePrefix(input.cookiePrefix);
  const clientIpHeader = input.clientIpHeader?.trim().toLowerCase();
  if (input.clientIpHeader !== undefined && !clientIpHeader) {
    throw new Error("clientIpHeader must not be empty");
  }
  const ipAddress = clientIpHeader
    ? { ipAddress: { ipAddressHeaders: [clientIpHeader] } }
    : {};
  const crossSubdomain = input.crossSubDomainCookies?.enabled === true;

  if (url.protocol !== "https:") {
    return {
      cookiePrefix: input.cookiePrefix,
      ...(input.crossSubDomainCookies
        ? { crossSubDomainCookies: input.crossSubDomainCookies }
        : {}),
      ...ipAddress,
    };
  }
  if (crossSubdomain) {
    return {
      cookiePrefix: input.cookiePrefix,
      useSecureCookies: true,
      crossSubDomainCookies: input.crossSubDomainCookies,
      ...ipAddress,
    };
  }
  return {
    cookiePrefix: `${HOST_PREFIX}${input.cookiePrefix}`,
    useSecureCookies: false,
    defaultCookieAttributes: { secure: true, path: "/" },
    ...ipAddress,
  };
}

/**
 * The exact session-token cookie name Better Auth produces for options built
 * by `secureCookieOptions`, for products that choose credentials by cookie
 * name. Pass the object `secureCookieOptions` returned.
 */
export function sessionCookieName(
  advanced: Pick<SecureCookieAdvancedOptions, "cookiePrefix" | "useSecureCookies">,
): string {
  const secure = advanced.useSecureCookies === true ? SECURE_PREFIX : "";
  return `${secure}${advanced.cookiePrefix}${SESSION_TOKEN_SUFFIX}`;
}

/**
 * Better Auth `session` options with the cookie cache off: every request
 * checks the session row, so a revoked session stops working immediately
 * instead of until the cached cookie expires (5 minutes by default).
 */
export function secureSessionOptions(): { cookieCache: { enabled: false } } {
  return { cookieCache: { enabled: false } };
}

export interface SecureEmailAndPasswordInput {
  /** Turn password sign-in on. Off by default: products sign people in
   * with email codes, social providers or OAuth. */
  enabled?: boolean;
}

/**
 * Better Auth `emailAndPassword` settings. Password sign-up is off unless a
 * product opts in: with it on and no verification, anyone can register an
 * address they don't own and sit on it until the real owner shows up. When
 * a product does enable passwords, the address must be verified before the
 * account can sign in.
 */
export function secureEmailAndPasswordOptions(
  input: SecureEmailAndPasswordInput = {},
): { enabled: false } | { enabled: true; requireEmailVerification: true } {
  return input.enabled === true
    ? { enabled: true, requireEmailVerification: true }
    : { enabled: false };
}
