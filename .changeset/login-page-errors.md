---
"@codelitdev/oauth-server-kit": patch
---

The hosted sign-in page now shows the auth API's error `message` (for example a product's signup refusal or an expired code) instead of always "Sign-in failed. Please try again.", which stays the fallback when the response has no message.
