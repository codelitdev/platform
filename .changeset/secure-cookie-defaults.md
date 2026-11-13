---
"@codelitdev/oauth-server-kit": minor
---

Add hardened Better Auth defaults. `@codelitdev/oauth-server-kit/better-auth` exports `secureCookieOptions` (`__Host-` session cookies over https, `__Secure-` with cross-subdomain cookies, plain over http, optional client-IP header), `sessionCookieName`, `secureSessionOptions` (no session cookie cache), `secureEmailAndPasswordOptions` (password sign-up off; opting in also requires a verified email before sign-in) and `isRecentlyAuthenticated`. Session identities now carry `authenticatedAt`. `@codelitdev/oauth-server-kit/express` exports `parseTrustProxy`, `DEFAULT_TRUST_PROXY` and `createClientIpMiddleware`.

Requires Better Auth 1.7.16 or later (`better-auth` and `@better-auth/oauth-provider` peer floor `^1.7.16`; tested on 1.7.22), which carries fixes for GHSA-fvxx-76fc-893x, GHSA-2f9c-7xj7-gh55 and GHSA-9hm7-xhfp-cx58. A product's resource client must be bound to its real Better Auth instance (`options` and a `$context` resolving `baseURL`), as newer `@better-auth/oauth-provider` requires.

**Product changes for this release**

- Upgrade `better-auth` and every `@better-auth/*` package together (1.7.22 needs `@better-auth/utils` 0.5.1, `better-call` 1.4.5 and `@better-fetch/fetch` 1.3.3; mismatched copies break plugin types). If your database ran Better Auth 1.7.0–1.7.2, make `account.issuer` nullable and drop `account_issuer_accountId_uidx` (see Better Auth's 1.7 upgrade guide).

- Spread `secureCookieOptions({ baseURL, cookiePrefix, clientIpHeader })` into `advanced`, `secureSessionOptions()` into `session`, and set `emailAndPassword: secureEmailAndPasswordOptions()`. Switching to `__Host-` renames the session cookie, so users sign in once more; select credentials with `sessionCookieName(advanced)`.
- Set `app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY))` and mount `createClientIpMiddleware` before Better Auth's handler.
- Under `__Host-` the OAuth provider's RP-initiated logout confirmation cookie is rejected by browsers; use cross-subdomain mode if you need that step.
