---
"@codelitdev/billing": minor
---

`createBilling` takes `planFeatures`, the feature keys each paid plan includes (for example `{ business: ["learner_sso"] }`), and the engine gains `hasFeature(billableEntityId, feature)`. In `cloud` mode it is true only when the entity's entitled paid plan (the same rules as `commercialState().activePaidPlan`) includes the feature. In `oss` mode it is always true. An unknown feature, no paid plan, or any error reading state is false. In `cloud` mode a `planFeatures` key with no offer throws `plan_features_invalid`.

**Product changes for this release**

- Declare `planFeatures` and gate features with `billing.hasFeature(...)` instead of keeping a separate plan-to-feature map. Plans do not inherit, so list a feature on every plan that includes it.
