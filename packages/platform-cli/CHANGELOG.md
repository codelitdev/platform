# @codelitdev/platform-cli

## 0.2.0

### Minor Changes

- 047058c: Replace versioned `upgrade` with `sync`, bundle the compatibility preset, and update the template.
  
  **CLI**
  
  - `sync` replaces `upgrade`. It re-renders the CLI-managed files from this release's template and refuses to overwrite a file whose hash no longer matches the manifest. Writes need a clean Git worktree; `--dry-run` works in a dirty one.
  - The manifest is `schemaVersion: 2`: it records the product name and slug and the CLI version that last synced, and drops `templateVersion`, `appliedUpgrades`, and `presetVersion`. v1 manifests are migrated on the next `sync`.
  - The compatibility preset ships inside the CLI (`dist/preset.json`). `@codelitdev/platform-preset` is no longer published.
  - External pins now come from the template's exact versions: better-auth 1.7.7, @electric-sql/pglite 0.5.8, drizzle-kit 0.31.10, Next.js 16.3.6, and React 19.2.8.
  - The only managed file is `.github/workflows/platform-conformance.yml`. `tooling/platform/config.ts` and the API README title codemod are removed.
  - The package includes its README.
  
  **Template**
  
  - `platform-conformance.yml` (managed) runs `doctor` with the pinned CLI version, `check:drift`, and the API package's `test:conformance` script. Lint, typecheck, test, and build move to a product-owned `code-quality.yml`.
  - `create` writes a product-owned `.github/dependabot.yml` that groups `@codelitdev/*` updates into one pull request per release.
  - The Better Auth schema is regenerated for 1.7.7, which drops `account.issuer`.
  - `.env.example` points at the Postgres service in `docker-compose.yml`.
  - Removed leftover reference-product branding, the unused `logger.ts`, and the duplicate root `generate:check` script.
  
  **Product changes for this release**
  
  - Add a `test:conformance` script to the API package that runs the product's `@codelitdev/platform-conformance` suites. The conformance workflow fails without it.
  - `sync` removes test, typecheck, and build from the managed workflow. If no other workflow runs them, copy `templates/saas-product/.github/workflows/code-quality.yml`.
  - Upgrade to the new external pins, including Next.js 16, or `doctor` fails.
  - Add a migration that drops or relaxes `account.issuer` before running Better Auth 1.7.7.
  - Handle the new `"malformed"` credential selection from `@codelitdev/platform` (see its release notes).

### Patch Changes

- 93b95f7: Derive generated product names from the destination directory basename so absolute and nested paths produce valid workspace scopes, and keep generated Next.js configuration stable after its first production build.

## 0.1.0

### Patch Changes

- 894896a: Add platform-cli create, doctor, and upgrade with managed-hash and codemod fixtures.
- Updated dependencies [894896a]
  - @codelitdev/platform-preset@0.1.0
