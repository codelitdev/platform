import { createPlatformError } from "./errors.js";
import type { PlatformError } from "./errors.js";
import type {
  AuthenticationResult,
  CredentialKind,
  PlatformCredential,
  TransportName,
} from "./types.js";

export type TransportCredentialKind = Exclude<CredentialKind, "system">;

export type PresentedCredential = {
  kind: TransportCredentialKind;
  secret: string;
};

export type HeaderMap = Readonly<Record<string, string | string[] | undefined>>;

export const DEFAULT_SESSION_COOKIE_NAME = "better-auth.session_token";
export const SECURE_SESSION_COOKIE_PREFIX = "__Secure-";

function headerValue(headers: HeaderMap, name: string): string | undefined {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(direct)) return direct[0];
  return direct;
}

function parseCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key === name) {
      const value = trimmed.slice(eq + 1).trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(\S+)/i.exec(authorization.trim());
  if (!match?.[1]) return undefined;
  return match[1];
}

/**
 * Collect credential mechanisms supplied on an HTTP request.
 * Never produces `system`.
 */
export function extractHttpCredentials(
  headers: HeaderMap,
  options: { sessionCookieName?: string } = {},
): PresentedCredential[] {
  const sessionCookieName =
    options.sessionCookieName ?? DEFAULT_SESSION_COOKIE_NAME;
  const presented: PresentedCredential[] = [];
  const cookieHeader = headerValue(headers, "cookie");
  // Better Auth prefixes cookies with `__Secure-` when it is configured for
  // HTTPS. Both names represent the same browser-session mechanism.
  const session =
    parseCookie(cookieHeader, sessionCookieName) ??
    parseCookie(
      cookieHeader,
      `${SECURE_SESSION_COOKIE_PREFIX}${sessionCookieName}`,
    );
  if (session) presented.push({ kind: "session", secret: session });
  const oauth = bearerToken(headerValue(headers, "authorization"));
  if (oauth) presented.push({ kind: "oauth", secret: oauth });
  const apiKey = headerValue(headers, "x-api-key");
  if (apiKey && apiKey.length > 0) {
    presented.push({ kind: "api_key", secret: apiKey });
  }
  return presented;
}

/**
 * MCP accepts OAuth bearer or API key, not browser sessions.
 * Never produces `system`.
 */
export function extractMcpCredentials(
  headers: HeaderMap,
): PresentedCredential[] {
  const presented: PresentedCredential[] = [];
  const oauth = bearerToken(headerValue(headers, "authorization"));
  if (oauth) presented.push({ kind: "oauth", secret: oauth });
  const apiKey = headerValue(headers, "x-api-key");
  if (apiKey && apiKey.length > 0) {
    presented.push({ kind: "api_key", secret: apiKey });
  }
  return presented;
}

export type CredentialSelection =
  | { kind: "absent" }
  | { kind: "ambiguous"; error: PlatformError }
  | { kind: "single"; credential: PresentedCredential };

export function selectSingleCredential(
  presented: readonly PresentedCredential[],
): CredentialSelection {
  if (presented.length === 0) return { kind: "absent" };
  if (presented.length > 1) {
    return {
      kind: "ambiguous",
      error: createPlatformError("credential_ambiguous"),
    };
  }
  return { kind: "single", credential: presented[0]! };
}

export function selectHttpCredential(
  headers: HeaderMap,
  options: { sessionCookieName?: string } = {},
): CredentialSelection {
  return selectSingleCredential(extractHttpCredentials(headers, options));
}

export function selectMcpCredential(headers: HeaderMap): CredentialSelection {
  return selectSingleCredential(extractMcpCredentials(headers));
}

/**
 * Map an authentication adapter result for a transport route.
 * Protected routes map `absent` to `unauthenticated`.
 * `rejected` is returned unchanged (no fallback).
 * A `system` credential from HTTP/MCP mapping becomes `internal_error`.
 */
export function mapTransportAuthentication<PrincipalId extends string>(
  result: AuthenticationResult<PrincipalId>,
  options: { publicRoute?: boolean; transport: TransportName },
): AuthenticationResult<PrincipalId> {
  if (result.kind === "authenticated") {
    if (result.credential.kind === "system") {
      return {
        kind: "rejected",
        error: createPlatformError("internal_error"),
      };
    }
    return result;
  }
  if (result.kind === "rejected") {
    return result;
  }
  if (options.publicRoute) return result;
  return {
    kind: "rejected",
    error: createPlatformError("unauthenticated"),
  };
}

export function createSystemCredential(
  credentialId?: string,
): PlatformCredential {
  const credential: PlatformCredential = { kind: "system" };
  if (credentialId !== undefined) credential.credentialId = credentialId;
  return credential;
}

export function isTransportCredentialKind(
  kind: CredentialKind,
): kind is TransportCredentialKind {
  return kind !== "system";
}
