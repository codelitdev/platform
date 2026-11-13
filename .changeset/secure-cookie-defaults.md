---
"@codelitdev/oauth-server-kit": minor
---

Add hardened Better Auth defaults. `@codelitdev/oauth-server-kit/better-auth` exports `secureCookieOptions` (`__Host-` session cookies over https, `__Secure-` with cross-subdomain cookies, plain over http, optional client-IP header), `sessionCookieName`, `secureSessionOptions` (no session cookie cache), `secureEmailAndPasswordOptions` (password sign-up off; opting in also requires a verified email before sign-in) and `isRecentlyAuthenticated`. Session identities now carry `authenticatedAt`. `@codelitdev/oauth-server-kit/express` exports `parseTrustProxy`, `DEFAULT_TRUST_PROXY` and `createClientIpMiddleware`.

**Product changes for this release**

- Spread `secureCookieOptions({ baseURL, cookiePrefix, clientIpHeader })` into `advanced`, `secureSessionOptions()` into `session`, and set `emailAndPassword: secureEmailAndPasswordOptions()`. Switching to `__Host-` renames the session cookie, so users sign in once more; select credentials with `sessionCookieName(advanced)`.
- Set `app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY))` and mount `createClientIpMiddleware` before Better Auth's handler.
- Under `__Host-` the OAuth provider's RP-initiated logout confirmation cookie is rejected by browsers; use cross-subdomain mode if you need that step.
