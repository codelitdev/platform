import type { AuthenticationResult, OAuthResourceClient } from "./types";

export interface VerifyOAuthAccessTokenOptions {
  oauthResourceClient: OAuthResourceClient;
  issuer: string;
  audiences: readonly string[];
  resourceMetadataMappings?: Readonly<Record<string, string>>;
}

function requireAbsoluteUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute URL`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${field} must use http or https`);
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error(`${field} must use https in production`);
  }
  return url.toString().replace(/\/$/, "");
}

function normalizedUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function claimStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function validateOAuthVerificationOptions(
  options: VerifyOAuthAccessTokenOptions,
) {
  requireAbsoluteUrl(options.issuer, "issuer");
  if (normalizedUniqueStrings(options.audiences).length === 0) {
    throw new Error("audiences must contain at least one value");
  }
  for (const value of Object.values(options.resourceMetadataMappings ?? {})) {
    requireAbsoluteUrl(value, "resourceMetadataMappings");
  }
}

/**
 * Verifies a Better Auth OAuth access token and returns protocol identity only.
 * Product claims are deliberately discarded.
 */
export async function verifyOAuthAccessToken(
  options: VerifyOAuthAccessTokenOptions,
  token: string,
): Promise<AuthenticationResult> {
  validateOAuthVerificationOptions(options);
  const issuer = requireAbsoluteUrl(options.issuer, "issuer");
  const audiences = normalizedUniqueStrings(options.audiences);
  if (!token.trim()) return { status: "invalid_token" };

  try {
    const claims = await options.oauthResourceClient
      .getActions()
      .verifyBearerToken(token, {
        verifyOptions: { issuer, audience: audiences },
        resourceMetadataMappings: options.resourceMetadataMappings ?? {},
      });

    const subject = optionalString(claims.sub);
    const claimIssuer = optionalString(claims.iss);
    const clientId = optionalString(claims.azp) ?? optionalString(claims.client_id);
    const tokenAudiences = normalizedUniqueStrings(claimStrings(claims.aud));
    const validatedAudiences = tokenAudiences.filter((audience) =>
      audiences.includes(audience),
    );

    if (
      !subject ||
      claimIssuer?.replace(/\/$/, "") !== issuer ||
      !clientId ||
      validatedAudiences.length === 0
    ) {
      return { status: "invalid_token" };
    }

    const scopeValue = claims.scope;
    const scopes = normalizedUniqueStrings(
      Array.isArray(scopeValue)
        ? claimStrings(scopeValue)
        : typeof scopeValue === "string"
          ? scopeValue.split(/\s+/)
          : [],
    );
    const email = optionalString(claims.email);
    const name = optionalString(claims.name);

    return {
      status: "authenticated",
      identity: {
        method: "oauth",
        issuer,
        subject,
        ...(email ? { email } : {}),
        ...(name ? { name } : {}),
        clientId,
        scopes,
        audiences: validatedAudiences,
      },
    };
  } catch {
    return { status: "invalid_token" };
  }
}
