---
"@codelitdev/oauth-server-kit": patch
---

The hosted login page keeps the email button disabled until Turnstile returns a token, and disables it again when the token expires, the widget errors, or it resets after a send. Before, the button could be pressed while the check was still running, which showed "Complete the security check, then try again."

The hosted pages also fit phone screens: on narrow screens the page and card padding shrink so the Turnstile widget (at least 300px wide) no longer pushes the card past the screen edge, and inputs use 16px text so iOS doesn't zoom in when they get focus.
