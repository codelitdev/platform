# CodeLit reference product

This is the executable reference composition for the CodeLit Platform. It is
intended for local development, conformance testing, and template validation.

## Requirements

- Node.js 22 or newer
- pnpm 10
- PostgreSQL for the API runtime

## Run locally

From the platform workspace root:

```bash
pnpm install
cp examples/reference-product/apps/api/.env.example examples/reference-product/apps/api/.env
pnpm --filter @reference-product/api migrate
pnpm --filter @reference-product/api dev
```

The API listens on `http://127.0.0.1:4000`. `SEED=1` in the example environment
creates local demo users, tenants, credentials, notes, and billing data. Do
not enable it for a production deployment.

In a second terminal, start the Next.js web app:

```bash
cp examples/reference-product/apps/web/.env.example examples/reference-product/apps/web/.env.local
pnpm --filter @reference-product/web dev
```

The web app proxies API requests through its server-side BFF using `API_URL`.
With `SEED=1`, open `/login` and use `owner@example.com` with password
`reference-password-1` under “Local demo password sign-in”.

## Checks

```bash
pnpm --filter @reference-product/api check:drift
pnpm --filter @reference-product/api test
pnpm --filter @reference-product/api typecheck
pnpm --filter @reference-product/web typecheck
```

The API test suite uses an isolated PGlite runtime and does not require the
local PostgreSQL database.
