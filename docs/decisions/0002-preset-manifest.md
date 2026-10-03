# ADR 0002: Preset manifest shape

Status: accepted; partly superseded by ADR 0006 (the preset now ships in
`@codelitdev/platform-cli`, without `presetVersion`)  
Date: 2026-09-02

## Context

Packages are independently versioned. Products pin exact versions in their
own lockfiles. Adopters still need a machine-readable compatibility bill
of materials so `doctor` and conformance can fail closed on insecure or
untested combinations.

## Decision

`@codelitdev/platform-preset` ships a versioned JSON manifest (architecture
§6.7) with:

- `schemaVersion: 1`
- `presetVersion`
- `runtime` pins for Node.js and Bun
- `packages` entries with `recommended`, `supported`, and monotonic
  `minimumSecure`
- `external` pins for selected peers (TypeScript, Express, ts-rest, Zod,
  Better Auth, Drizzle, MCP SDK, Pino, Bun types, PGlite, dodopayments, and
  others as extraction proceeds)

The preset has no runtime code. It validates a product manifest and
lockfile; it does not mutate dependencies. Renovate performs upgrades
through reviewable product pull requests.

## Consequences

- New products receive `recommended` versions.
- Existing adopters stay inside `supported` until they upgrade.
- `doctor` and conformance fail when a resolved version is older than
  `minimumSecure`.
- A compatibility change also releases the preset; an ordinary
  single-package patch may update `recommended` and `minimumSecure`
  without a major preset bump.
