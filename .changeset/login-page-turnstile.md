---
"@codelitdev/oauth-server-kit": minor
---

`createOAuthPagesRouter` takes an optional `captcha: { provider: "cloudflare-turnstile", siteKey }`. The hosted email sign-in form then renders a Cloudflare Turnstile widget and sends its token in the `x-captcha-response` header when it asks for a code. Without `captcha` the pages are unchanged.

### Product changes

To turn it on, pass `captcha` to `createOAuthPagesRouter` and add Better Auth's `captcha` plugin with `provider: "cloudflare-turnstile"`, the secret key and `endpoints: ["/email-otp/send-verification-otp"]`. Configure both or neither.
