---
"@codelitdev/billing": minor
---

A payer can switch offers while a checkout is open.

- `startCheckout` for another offer, such as yearly after monthly, now replaces the payer's own open checkout instead of failing with `checkout_pending` until it expires. The old checkout becomes `abandoned`. If it is paid anyway, it becomes `conflicted`; it grants access when nothing else does, and otherwise the second subscription is quarantined. Another payer's open checkout still returns `checkout_pending`.
- An expired checkout for another offer or payer is no longer reopened for the new request.
- `CreateCheckoutInput` gains an optional `expiresAt`. The Lemon Squeezy adapter sends it as the checkout's `expires_at`, so the old page stops working when the attempt expires. Dodo checkout sessions take no expiry.

**Product changes for this release**

- None required. A product that showed a message for `checkout_pending` when a person switched intervals can keep it for the other-payer case.
