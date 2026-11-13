---
"@codelitdev/platform": minor
"@codelitdev/platform-conformance": minor
"@codelitdev/platform-cli": minor
---

REST contracts move from ts-rest to oRPC, and every product commits its OpenAPI document (ADR 0017).

- `@codelitdev/platform/rest` (new): `platformErrors`, `encodePlatformErrorBody` and `platformErrorResponseBodySchema` keep oRPC error bodies and the generated OpenAPI in the platform `{ code, message, details? }` shape. Also adds `listOperationIds`, `normalizeOpenApiDocument`, and `writeOpenApiDocument`/`runOpenApiScript` for a product's `generate:openapi --check` script. It has no runtime dependency on oRPC.
- `@codelitdev/platform-conformance`: **breaking.** `openapiDocument()` must also return `committedDocumentCurrent`. The `openapi` suite fails when the committed `openapi.json` does not match the contract.
- `@codelitdev/platform-cli`: the template defines its contract with oRPC on Express, commits `apps/api/openapi.json`, and adds `generate:openapi`/`check:openapi` (`check:openapi` is in `check:drift` and CI). The preset pins `@orpc/*` 1.16.1 instead of `@ts-rest/*`. The `@anatine/zod-openapi` patch and the `ts-deepmerge` override are removed. `doctor` now checks the lowest version when several manifests declare the same package, so a vulnerable pin can no longer be hidden by directory read order.

Existing products: follow ADR 0017. Add `generate:openapi` to your release version step so each release commits the document hosted docs serve.
