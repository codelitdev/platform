# Former-repository history disposition

Status: accepted (in-repo record). Physical GitHub archival of the former
repositories is an external operation and is not claimed complete by this
document.

The source for `@codelitdev/billing`, `@codelitdev/oauth-server-kit`, and
`@codelitdev/design-system` now lives in this Platform monorepo. Existing
published package names, public contracts, and npm provenance continue
uninterrupted. Moving source does not merge the packages into one runtime or
require lockstep versions.

## Repositories

| Former repository (origin)    | Current source              | npm package                    | Disposition                                                                                                                                                                                                                                       |
| ----------------------------- | --------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codelitdev/billing`          | `packages/billing`          | `@codelitdev/billing`          | Source of truth is Platform. Preserve git history already imported into this workspace. Archive the former GitHub repository only after issues, discussions, release notes, package provenance, and security-reporting paths are redirected here. |
| `codelitdev/oauth-server-kit` | `packages/oauth-server-kit` | `@codelitdev/oauth-server-kit` | Same as billing.                                                                                                                                                                                                                                  |
| `codelitdev/design-system`    | `packages/design-system`    | `@codelitdev/design-system`    | Same as billing.                                                                                                                                                                                                                                  |

## What is preserved in Platform

- Package source, tests, docs, ADRs, and runbooks under `packages/*`.
- Independent package versions and Changesets release metadata.
- Published npm contracts and `publishConfig` (`public`, `alpha` tag).
- Security reporting through this repository's `SECURITY.md` and GitHub
  Security tab.
- Architecture boundaries in `docs/architecture.md`.

## What is intentionally not copied

- Nested `.git` directories from the former repositories.
- Package-local lockfiles that would fork the workspace lockfile.
- Copied `node_modules`, build output, coverage, or repository-level hooks
  from the former roots.

## Redirects still required (external)

Until maintainers archive the former GitHub repositories:

1. Issues and discussions redirect to `codelitdev/platform`.
2. Security advisories and private vulnerability reports use this
   repository's Security tab.
3. README of each former repository points at the corresponding
   `packages/<name>` directory and npm package.
4. Release notes remain on npm; GitHub Releases on the former repos should
   link to npm and to this repository's Changesets history.

This record is the Phase 0 exit for history disposition. Archiving the
empty former GitHub repositories is tracked as an operator task, not as an
in-repo code change.
