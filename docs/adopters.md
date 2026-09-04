# Adopting CodeLit Platform packages

Product repositories consume published packages; they do not link to this workspace. Pin direct dependencies to exact versions and commit the product lockfile.

Configure Renovate to group Platform updates:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "packageRules": [
    {
      "matchPackageNames": ["@codelitdev/**"],
      "groupName": "codelitdev platform packages",
      "rangeStrategy": "pin"
    }
  ]
}
```

Every generated product must run its own integration tests plus `@codelitdev/platform-conformance` before merging an update. Patch updates may auto-merge only when those checks and the product deployment gate pass.

Security releases follow the same reviewable path with expedited pull requests. A published package does not alter an existing product until its manifest and lockfile are updated and the product is redeployed.

Template-structure changes are different from package updates. Apply them only through a versioned `@codelitdev/platform-cli` codemod; never merge or regenerate the current template over product-owned files.
