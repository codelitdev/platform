import type { AuthenticatedIdentity } from "./types";

/** A sign-in stamped this far ahead of `now` is clock skew, not a forgery. */
const CLOCK_SKEW_MS = 60_000;

export interface IsRecentlyAuthenticatedOptions {
  maxAgeMs: number;
  now?: Date;
}

/**
 * Whether the identity is a browser session that signed in within `maxAgeMs`.
 * OAuth identities never count: a bearer token carries no interactive
 * sign-in. Products choose which actions require this (step-up checks).
 */
export function isRecentlyAuthenticated(
  identity: AuthenticatedIdentity,
  options: IsRecentlyAuthenticatedOptions,
): boolean {
  if (identity.method !== "session") return false;
  const signedInAt = identity.authenticatedAt?.getTime();
  if (signedInAt === undefined || !Number.isFinite(signedInAt)) return false;
  const age = (options.now ?? new Date()).getTime() - signedInAt;
  return age >= -CLOCK_SKEW_MS && age <= options.maxAgeMs;
}
