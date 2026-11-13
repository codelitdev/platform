import type { RequestHandler } from "express";

/**
 * Private networks: the cluster and local development. Fine when clients come
 * from the public internet. If clients can reach the app from a private
 * network too, set `TRUST_PROXY` to your proxies' actual addresses or subnet,
 * or those clients could forge their address (Better Auth gives the same
 * advice for its own `trustedProxies`).
 */
export const DEFAULT_TRUST_PROXY = "loopback, linklocal, uniquelocal";

/**
 * Parses a `TRUST_PROXY` value into what Express's `trust proxy` setting
 * accepts: a hop count (`1`), `true`/`false`, or a comma-separated list of
 * addresses, CIDRs and the names `loopback`, `linklocal`, `uniquelocal`.
 * Empty means {@link DEFAULT_TRUST_PROXY}.
 */
export function parseTrustProxy(raw?: string): boolean | number | string {
  const value = raw?.trim();
  if (!value) return DEFAULT_TRUST_PROXY;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  return value;
}

export interface CreateClientIpMiddlewareOptions {
  /** Internal header to carry the resolved client address. */
  header: string;
}

/**
 * Sets `req.headers[header]` to the client address, overwriting anything the
 * client sent. Pair it with `secureCookieOptions({ clientIpHeader })` so
 * Better Auth's rate limiting and session IP never read `X-Forwarded-For`.
 *
 * The app must call `app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY))`
 * first and mount this before Better Auth's handler. `req.ip` then walks
 * `X-Forwarded-For` from the right, skipping trusted proxy hops, so the
 * attacker-controlled left side never counts.
 */
export function createClientIpMiddleware(
  options: CreateClientIpMiddlewareOptions,
): RequestHandler {
  const header = options.header.trim().toLowerCase();
  if (!header) throw new Error("header must not be empty");
  return (req, _res, next) => {
    req.headers[header] = req.ip || req.socket.remoteAddress || "unknown";
    next();
  };
}
