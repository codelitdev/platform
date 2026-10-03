# ADR 0006: Operating model before 1.0

Status: accepted  
Date: 2026-10-03

## Context

The Platform packages, template, and CLI are still changing quickly, and
every generated or adopting product (CourseLit, SendLit, FrontLit, MediaLit)
is maintained by the same team. Independent package versions, prerelease
tags, and a versioned codemod registry added coordination cost without a
second-party adopter to protect. A stale `latest` dist-tag left
`bunx @codelitdev/platform-cli` on a release whose preset rejected every
prerelease package.

## Decision

- All `@codelitdev/*` packages form one Changesets `fixed` group and release
  together under one version. Releases use plain `0.x` versions without
  prerelease tags, so every publish moves `latest`.
- The compatibility preset ships inside `@codelitdev/platform-cli`
  (`src/preset.json`) instead of a separate `@codelitdev/platform-preset`
  package. With one release version, a preset change always ships with a CLI
  release, and the managed workflow pins the CLI version, so the rules
  `doctor` applies follow the product's last `sync`. The product manifest
  records only `cliVersion`, not a separate `presetVersion`.
- `scripts/sync-preset.mjs` generates most of the preset: `recommended` is
  the release version, and `external` pins are the exact versions the
  template declares, so the template is the single source for third-party
  versions. `bun run verify` fails if they drift. `supported` and
  `minimumSecure` stay hand-maintained.
- `platform-cli sync` replaces versioned `upgrade`. It re-renders the
  enumerated managed files from the template in the running CLI release,
  replacing a file only when its hash matches the manifest. The manifest
  records the product tokens and the CLI version that last synced instead
  of a template version and applied-upgrade list.
- The managed set stays minimal: only the platform conformance workflow
  (`doctor`, schema drift, `test:conformance`). The placeholder
  `tooling/platform/config.ts`, which nothing imported, is removed.
  Code quality CI is a separate product-owned workflow written once by
  `create`.
- Dependabot replaces Renovate for Platform updates: each product's
  `.github/dependabot.yml` groups `@codelitdev/*` into one pull request per
  release, gated by the platform conformance workflow. Dependabot already
  runs in every product repository; Renovate was never installed.
- The CLI does not change product-owned files. A release that requires
  product changes states them in its Changeset; the product applies them.

## Consequences

- Supersedes ADR 0002's separate preset package, `presetVersion`, and use of
  Renovate (its manifest shape and `minimumSecure` rules still apply), ADR
  0004's independent versioning and prerelease guidance, and
  ADR 0003's requirement that product-owned changes use semantic codemods.
  Managed-file hashing and conflict rules from ADR 0003 still apply.
- There is no automated path for changing product-owned source. Revisit
  codemods if products outside the team adopt the Platform.
