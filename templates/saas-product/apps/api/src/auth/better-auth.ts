import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as authSchema from "../db/schema/auth.generated.js";
import type { AppDb } from "../types.js";
import { AUTH_BASE_PATH, authUrls, referenceAuthOptions } from "./options.js";

export function createReferenceAuth(input: {
  db: AppDb;
  publicApiUrl: string;
  secret: string;
  webOrigin?: string;
}) {
  if (input.secret.length < 32) {
    throw new Error("better_auth_secret_too_short");
  }
  const urls = authUrls(input.publicApiUrl, input.webOrigin);
  const auth = betterAuth(
    referenceAuthOptions({
      publicApiUrl: input.publicApiUrl,
      secret: input.secret,
      webOrigin: input.webOrigin,
      database: drizzleAdapter(input.db, {
        provider: "pg",
        schema: authSchema,
      }),
    }),
  );
  const oauthResourceClient = oauthProviderResourceClient(auth);
  return {
    auth,
    oauthResourceClient,
    ...urls,
    authBasePath: AUTH_BASE_PATH,
  };
}

export type ReferenceAuth = ReturnType<typeof createReferenceAuth>;
