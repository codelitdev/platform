import type { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";

export type AuthenticatedIdentity =
    | {
          method: "session";
          issuer: string;
          subject: string;
          email: string;
          name?: string | null;
          scopes: [];
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

type ConfiguredResourceClientAuth = {
    options: { baseURL?: string; basePath?: string };
    $context: Promise<unknown>;
};

export type OAuthResourceClient = ReturnType<
    typeof oauthProviderResourceClient<ConfiguredResourceClientAuth>
>;
