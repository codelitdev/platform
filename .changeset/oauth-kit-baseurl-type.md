---
"@codelitdev/oauth-server-kit": patch
---

Accept Better Auth 1.7 instances in `createMcpOAuthDiscoveryRoutes` without a cast: `auth.options.baseURL` is typed as `unknown` and rejected at runtime unless it is a static URL string.
