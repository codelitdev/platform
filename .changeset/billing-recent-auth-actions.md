---
"@codelitdev/platform": minor
---

`createBillingActionGrants` takes `recentAuthActions`, the billing actions that need a recent sign-in. The default is every action, as before. Pass only the actions that are hard to undo, such as `["payer_transfer"]`, or `[]` for none.

**Product changes for this release**

- Asking for a fresh sign-in before checkout, a plan change, the portal, or a cancellation stops people mid-purchase without protecting anything: the single-use token already stops replay and CSRF, and the provider confirms the payer. Set `recentAuthActions` to the actions your product treats as sensitive.
