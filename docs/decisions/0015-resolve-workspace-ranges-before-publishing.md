# ADR 0015: Resolve workspace ranges before publishing

Status: accepted  
Date: 2026-10-09

## Context

Packages in this repository depend on each other with `workspace:` ranges.
`changeset publish` publishes with `npm publish`, which copies a manifest
as committed and does not rewrite `workspace:` ranges, unlike Bun and pnpm.
Until 0.4.0 these ranges appeared only in `devDependencies`, which npm
never installs for consumers. 0.4.0 published `@codelitdev/platform` with
an optional peer of `workspace:*`, and npm refuses to install it
(`EUNSUPPORTEDPROTOCOL`). Bun installs it, and `bun pm pack` rewrites the
range, so testing with packed tarballs did not catch it.

## Decision

- Ranges that consumers read (`dependencies`, `peerDependencies`,
  `optionalDependencies`) on another `@codelitdev/*` package are written as
  real ranges, such as `>=0.4.0`. Changesets keeps those ranges up to date
  when versions change.
- The `release` script runs `scripts/resolve-workspace-ranges.mjs` after
  `verify` and before `changeset publish`. It rewrites every `workspace:`
  range left in a public package's manifest to a real version:
  - `workspace:^` becomes `^<version>`
  - `workspace:~` becomes `~<version>`
  - `workspace:*` becomes `<version>`
  - `workspace:<range>` becomes `<range>`
- The rewrite happens only on the release job's checkout, which is thrown
  away. It is never committed, and the release PR keeps `workspace:` ranges.
- Workspace patterns are expanded one folder level at a time. A level is a
  literal name or `*`; any other pattern stops the release, so a public
  package is never skipped.

## Consequences

- A published manifest differs from the committed one only in its
  `workspace:` ranges. Today those are only in `devDependencies`.
- A `workspace:` range written by mistake in a consumer-facing field still
  publishes something npm can install. `workspace:*` becomes an exact
  version, which is stricter than intended for a peer.
- Publishing by hand needs the same script first; `npm publish` alone
  reintroduces the problem.
- A new workspace pattern that uses other wildcards needs the script
  changed before the next release.
