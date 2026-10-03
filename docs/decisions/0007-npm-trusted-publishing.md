# ADR 0007: Publishing to npm

Status: accepted  
Date: 2026-10-04

## Context

The Release workflow authenticated to npm with an `NPM_TOKEN` secret that
was never added to the repository, so no release could publish. Organization
secrets were unavailable to the then-private repository on the current GitHub
plan. npm is also restricting tokens that bypass two-factor authentication:
account changes from August 2026 and direct publishing from January 2027.

The workflow also requested provenance attestations, which npm only accepts
from public source repositories. The repository was private when this ADR
was first written and was made public on 2026-10-04.

Separately, `@codelitdev/oauth-server-kit@0.1.0` was published and then
unpublished. npm never accepts a version number that has been used, even
after it is unpublished, and ADR 0006 rules out prerelease tags.

## Decision

- `release.yml` publishes through npm trusted publishing (OIDC). Each
  `@codelitdev/*` package on npmjs.com trusts GitHub Actions for
  `codelitdev/platform`, workflow `release.yml`, with no environment, and
  allows `npm publish` but not `npm dist-tag`. The job requests
  `id-token: write`, runs Node 24 with npm 11.5.1 or later, and has no
  `NPM_TOKEN` secret or token-writing `.npmrc`.
- Releases publish with provenance (`NPM_CONFIG_PROVENANCE`), which needs
  the repository to stay public and every package's `repository.url` to
  match it.
- A package added to the fixed group must have its trusted publisher
  configured on npmjs.com before the release that first publishes it.
- The release after `0.1.0-alpha.x` is `0.2.0`. Every package was set to a
  `0.1.0` starting version so the pending minor changesets skip `0.1.0`,
  which `oauth-server-kit` can never publish. Because all packages release
  together, no package uses `0.1.0`.

## Consequences

- A release needs no long-lived npm credential in GitHub, and is unaffected
  by the bypass-2FA token restrictions.
- Moving or renaming the repository or `release.yml` breaks publishing until
  every package's trusted publisher is updated on npmjs.com.
- Making the repository private again breaks publishing until provenance
  is turned off.
- Once trusted publishing has worked, each package's publishing access can
  require two-factor authentication and disallow bypass tokens without
  affecting releases.
- Never unpublish a released version. Its number stays unavailable, and the
  fixed group has to skip it for every package.
