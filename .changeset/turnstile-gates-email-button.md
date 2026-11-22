---
"@codelitdev/oauth-server-kit": patch
---

The hosted login page keeps the email button disabled until Turnstile returns a token, and disables it again when the token expires, the widget errors, or it resets after a send. Before, the button could be pressed while the check was still running, which showed "Complete the security check, then try again."
