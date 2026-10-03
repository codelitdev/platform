# Adopting CodeLit Platform packages

Product repositories consume published packages; they do not link to this workspace. Pin direct dependencies to exact versions and commit the product lockfile.

Configure Dependabot to open one grouped pull request per Platform release. `platform-cli create` writes this file as `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "bun" # "npm" for npm or pnpm repositories
    directory: "/"
    schedule:
      interval: "daily"
    allow:
      - dependency-name: "@codelitdev/*"
    groups:
      codelit-platform:
        patterns:
          - "@codelitdev/*"
```

`allow` limits version updates to Platform packages. Dependabot security updates do not support Bun, so Bun products must track other vulnerable dependencies separately.

Every generated product must run its own integration tests plus `@codelitdev/platform-conformance` before merging an update. Patch updates may auto-merge only when those checks and the product deployment gate pass.

When a product declares MCP support, its conformance adapter must exercise its HTTP MCP transport and return response headers. The suite verifies that an unauthenticated request returns `401` with a `WWW-Authenticate: Bearer resource_metadata="..."` challenge pointing to that MCP resource's protected-resource metadata URL. This includes products that accept both OAuth tokens and API keys.

Products with different routes and domain models can run the independent `runMcpDiscoveryConformance` suite instead of adapting the reference product's notes fixture. See the [package README](../packages/platform-conformance/README.md) for current coverage and product CI guidance.

Security releases follow the same reviewable path with expedited pull requests. A published package does not alter an existing product until its manifest and lockfile are updated and the product is redeployed.

All `@codelitdev/*` packages release together under one version, so a Platform update moves every Platform dependency to the same version.

Template-structure changes are different from package updates. Run `bunx @codelitdev/platform-cli@<version> sync` to bring the CLI-managed files to that release, and apply any product-owned changes listed in the release notes yourself. Never merge or regenerate the current template over product-owned files.
