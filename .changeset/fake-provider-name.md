---
"@codelitdev/billing": patch
---

`FakeBillingProvider` takes an optional `provider` name, so tests can compose two providers. A new test covers serving subscriptions on one provider after checkout moves to another.
