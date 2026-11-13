# ADR 0018: Secure session cookies, no cookie cache, trusted client IP

Status: accepted  
Date: 2026-11-13

## Context

CourseLit hardened its Better Auth setup locally. SendLit and MediaLit have the
same exposure, and each would otherwise re-derive it. The kit does not create
the Better Auth instance, so these must be helpers products spread into their
own config.

## Decision

- Session cookies default to `__Host-<prefix>.session_token` over https
  (Secure, `Path=/`, no `Domain`) so a sibling subdomain cannot plant or
  shadow them. Better Auth only knows `__Secure-`, so `__Host-` is folded into
  `cookiePrefix` with `useSecureCookies: false` and Secure set through
  `defaultCookieAttributes`. Products that need cross-subdomain cookies keep
  `__Secure-` (`__Host-` forbids `Domain`). Plain names are used over http.
  Exposed as `secureCookieOptions` and `sessionCookieName`.
- Password sign-up is off by default (`secureEmailAndPasswordOptions`); a
  product that opts in must also require a verified email before sign-in,
  so nobody can register an address they don't own and sit on it.
- The session cookie cache is off (`secureSessionOptions`): every request
  reads the session row, so a revoked session stops working immediately.
- The client address comes from a trusted proxy chain: the app sets Express
  `trust proxy` (`parseTrustProxy`), `createClientIpMiddleware` writes `req.ip`
  (which walks `X-Forwarded-For` from the right) into an internal header,
  overwriting client input, and Better Auth is told to read only that header.
- Session identities expose `authenticatedAt` (the session's `createdAt`) and
  `isRecentlyAuthenticated` supports step-up checks. Products decide which
  actions need it; OAuth identities never count.

## Consequences

- `@better-auth/oauth-provider` sets its logout-confirmation cookie
  (`<session cookie>.oauth_logout_confirmation`) on
  `/api/auth/oauth2/end-session/confirm`; browsers reject a `__Host-` cookie
  with that path. Neither plugin options nor `advanced.cookies` can change its
  name or path, so under `__Host-` the confirmation step of RP-initiated
  logout does not complete. Accepted; products needing it use cross-subdomain
  (`__Secure-`) mode.
- Disabling the cookie cache costs one session lookup per request, acceptable
  at our scale.
- Changing the cookie name logs existing users out once.
