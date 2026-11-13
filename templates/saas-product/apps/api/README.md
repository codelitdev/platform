# __PRODUCT_NAME__ API

Product-owned application services live here.

## REST contract and OpenAPI

The REST API is defined as an oRPC contract in `packages/api-contract`. The
contract decides validation, status codes, and the OpenAPI document. Declare
platform errors on each route with `platformErrors(...)` from
`@codelitdev/platform/rest` so the runtime body and the documented body are
both `{ code, message, details? }`.

Open the interactive Swagger UI at `GET /docs`, or fetch the running API's
document from `GET /openapi.json`.

### Committed `openapi.json`

`apps/api/openapi.json` is committed. Hosted docs serve this file, not the
running API, so it must match the contract of the release it ships with.

- `bun run generate:openapi` (here or at the repository root) rewrites it from
  the contract. It does not start the server or need a database.
- `bun run check:openapi` fails when the file is stale. It is part of
  `check:drift` and runs in CI, so a contract change without the regenerated
  file cannot merge.
- Your release version step must run `bun run generate:openapi` so the release
  commit carries the document for that version. With changesets, for example:
  `"version-packages": "changeset version && bun run generate:openapi"`.

`info.version` comes from this package's `version`, and the server URL comes
from `OPENAPI_PUBLIC_SERVER_URL` in `src/openapi.ts`. Set it to your
production API URL.
