import type { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import type { BetterAuthOptions } from "better-auth/types";

export type AuthenticatedIdentity =
  | {
      method: "session";
      issuer: string;
      subject: string;
      email: string;
      name?: string | null;
      scopes: [];
      /** When the session was created (the sign-in time), for step-up checks. */
      authenticatedAt: Date;
    }
  | {
      method: "oauth";
      issuer: string;
      subject: string;
      email?: string;
      name?: string | null;
      clientId: string;
      scopes: string[];
      audiences: string[];
    };

export type AuthenticationResult =
  | { status: "authenticated"; identity: AuthenticatedIdentity }
  | { status: "missing" }
  | { status: "invalid_token" }
  | { status: "unavailable"; cause?: unknown };

// The product's Better Auth instance. Since @better-auth/oauth-provider 1.7.7
// (checked on 1.7.22) a bound resource client needs the instance's options and a context
// that resolves its baseURL, so it can find the issuer's JWKS itself.
type ConfiguredResourceClientAuth = {
  options: BetterAuthOptions;
  $context: Promise<{ baseURL: string }>;
};

export type OAuthResourceClient = ReturnType<
  typeof oauthProviderResourceClient<ConfiguredResourceClientAuth>
>;
