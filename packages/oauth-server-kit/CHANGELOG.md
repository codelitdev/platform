# @codelitdev/oauth-server-kit

## 0.8.0

No changes in this release.

## 0.7.0

No changes in this release.

## 0.6.0

### Minor Changes

- 02277cf: `createOAuthPagesRouter` takes an optional `captcha: { provider: "cloudflare-turnstile", siteKey }`. The hosted email sign-in form then renders a Cloudflare Turnstile widget and sends its token in the `x-captcha-response` header when it asks for a code. Without `captcha` the pages are unchanged.
  
  ### Product changes
  
  To turn it on, pass `captcha` to `createOAuthPagesRouter` and add Better Auth's `captcha` plugin with `provider: "cloudflare-turnstile"`, the secret key and `endpoints: ["/email-otp/send-verification-otp"]`. Configure both or neither.

## 0.5.0

No changes in this release.

## 0.4.2

### Patch Changes

- 7e59ce1: The hosted sign-in page now shows the auth API's error `message` (for example a product's signup refusal or an expired code) instead of always "Sign-in failed. Please try again.", which stays the fallback when the response has no message.

## 0.4.1

No changes in this release.

## 0.4.0

No changes in this release.

## 0.3.0

No changes in this release.

## 0.2.0

### Patch Changes

- 047058c: Accept Better Auth 1.7 instances in `createMcpOAuthDiscoveryRoutes` without a cast: `auth.options.baseURL` is typed as `unknown` and rejected at runtime unless it is a static URL string.

## 0.1.1

### Patch Changes

- Publish OAuth Server Kit as a stable release at `0.1.1`; npm permanently
  reserves its deleted `0.1.0` version.
