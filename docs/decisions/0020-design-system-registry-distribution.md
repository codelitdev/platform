# ADR 0020: Products install design-system components through a versioned shadcn registry

Status: accepted  
Date: 2026-11-22

## Context

`@codelitdev/design-system` ships its React components as a shadcn registry
(`registry/codelit/ui/*`, built to `public/r/*.json`). In practice no product
had the registry in its `components.json`; CourseLit copied the files into
`components/ui/codelit/` by hand. Three things made the CLI route unattractive:

- Registry items had no install target, so `shadcn add @codelit/button`
  wrote `components/ui/button.tsx` and overwrote a stock shadcn button.
- The registry was served from the `main` branch on GitHub, so an install
  took whatever was on `main` and an app had no record of which version it had.
- `public/r` was rebuilt by hand and had drifted from its sources.

Shared UI such as the planned onboarding layout will also ship through this
registry, so the route has to work before more is added to it.

## Decision

- Products install design-system components with the shadcn CLI, using the
  `@codelit` registry in each app's `components.json`. No more hand copies.
- Every registry file has a `target` under `@ui/codelit/`, so components
  install into `<ui alias>/codelit/` alongside, not over, stock shadcn
  components. This needs shadcn CLI 4.21.0 or later.
- The built registry (`public/r`) ships inside the npm package. Apps point the
  registry at that exact release on jsDelivr
  (`https://cdn.jsdelivr.net/npm/@codelitdev/design-system@<version>/public/r/{name}.json`),
  using the same version as their npm dependency and bumping both together.
- `bun run verify` rebuilds the registry and fails when `public/r` is stale or
  a file has no `@ui/codelit/` target.

## Consequences

- An app's registry version is visible in `components.json` and matches its
  token version, so components and tokens can't drift apart silently.
- Registry changes reach products only through a release, like any other
  package change. There is no "fix on `main`, re-run `add`" shortcut.
- Installs depend on jsDelivr being reachable. Installed files are committed
  to the app, so this affects adding and updating components, not builds.
- Updating means re-running `add --overwrite`, which replaces local edits.
  Products that need a different component should wrap it or fork it under a
  different name rather than edit the installed copy.
