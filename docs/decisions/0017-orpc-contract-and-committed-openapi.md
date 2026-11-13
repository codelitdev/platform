# ADR 0017: oRPC contracts and a committed OpenAPI document

Status: accepted  
Date: 2026-11-13

## Context

The template, the reference product, SendLit, FrontLit, and CourseLit define
their REST APIs with ts-rest and generate OpenAPI with `@ts-rest/open-api`.
ts-rest has had no release since `3.53.0-rc.1` (June 2025). Its OpenAPI
generator depends on `@anatine/zod-openapi`, which needed a local patch, and
it supports Zod 3 only. MediaLit uses Express with Joi and swagger-autogen, so
its document comes from hand-written comments and does not match the code.

A survey of the four products (2026-11-13) found:

- Every product runs Express 4. The Platform packages also assume Express:
  `oauth-server-kit` exports Express routers, and `observability` lists Express
  as a peer. Products also depend on Express for raw-body webhooks, rate
  limiters, SSE, WebSockets, tus, multipart uploads, and about 50 test files
  that build an Express app.
- SendLit and FrontLit use the contract for typed clients. SendLit's public
  SDK is built on ts-rest types, and both web apps call `initClient`.
- Contract keys are used as operation ids by authorization policies and MCP
  parity in SendLit, FrontLit, and CourseLit.
- Hosted FrontLit serves each product's committed `openapi.json` at
  `<product-website>/openapi.json`. Only SendLit and CourseLit commit the
  file, and neither regenerates it as part of a release.

## Decision

- **Contracts are oRPC contracts** (`@orpc/contract`) built with Zod. They
  stay in the product's `packages/api-contract`. Routes keep their keys as
  operation ids, and nested routers use dot paths (`settings.esps.list`).
- **Express stays.** oRPC's `OpenAPIHandler` from `@orpc/openapi/node` runs as
  Express middleware. Requests it does not match fall through to the rest of
  the app, so webhooks, Better Auth, the kit routers, and uploads are
  unchanged. We rejected Hono and Fastify: replacing Express would ripple
  through the Platform kits and every product without improving the API
  documentation.
- **Errors keep the platform shape.** `@codelitdev/platform/rest` adds:
  - `platformErrors(...codes)`, which declares platform error codes on a route.
  - `encodePlatformErrorBody`, which is the handler's
    `customErrorResponseBodyEncoder`.
  - `platformErrorResponseBodySchema`, which is the generator's
    `customErrorResponseBodySchema`.

  The runtime body and the documented body are therefore both
  `{ code, message, details? }`. A route can declare a code that is not a
  platform code, with its own `data` schema (for example readiness on 503).
  Its body is then that data unchanged. This is how products with their own
  error shapes migrate. Input validation failures and thrown exceptions
  become platform bodies, and internal messages are never exposed.
- **The OpenAPI document is generated from the contract alone.** Generation
  uses `OpenAPIGenerator` with `@orpc/zod`'s Zod 3 converter. It does not
  start the server or need a database. The output is OpenAPI 3.1.
- **Every product commits `apps/api/openapi.json`:**
  - `generate:openapi` writes the file. `info.version` is the API package
    version, and the server URL is the production API URL.
  - `check:openapi`, which is `generate:openapi --check`, fails CI when the
    file is stale. It is part of `check:drift`.
  - The release version step runs `generate:openapi`, so the release commit
    carries the document for that release. This repository does it in
    `version-packages`. Products add it to their own version step.
  - `platform-conformance` fails a product that declares `openapi` when its
    committed document does not match the contract
    (`committedDocumentCurrent`).
- **Versions:** oRPC is pinned to exact versions in the preset (`1.16.1`), and
  Zod stays on 3.25. oRPC accepts Zod 4 through `@orpc/zod/zod4`, so moving
  to Zod 4 is a separate decision.

## Consequences

- ts-rest, `@anatine/zod-openapi`, its patch, and the `ts-deepmerge` override
  are gone from this repository and the template.
- Paths use `{param}` instead of `:param`. Code that reads contract paths
  directly must change, for example CourseLit's policy resolver and its
  generated MCP tools.
- oRPC's typed client throws on error responses. ts-rest returned a
  `{ status, body }` union instead. SendLit's and FrontLit's client wrappers
  and SendLit's SDK change shape when they migrate.
- Each committed `openapi.json` changes once in a large diff: from OpenAPI 3.0
  to 3.1, a different schema converter, and fuller error responses. Docs
  renderers must accept 3.1.
- oRPC 2.0 is in beta. A future major upgrade is a contract-builder migration
  across products, so we pin exact versions and upgrade deliberately.
- Product migration order: CourseLit (no typed client), MediaLit (adopt a
  contract for its public routes and replace swagger-autogen), FrontLit, and
  then SendLit (its public SDK is affected).
