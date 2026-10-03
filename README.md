# CodeLit Platform

CodeLit Platform is the source monorepo for shared CodeLit infrastructure packages and the product bootstrap. Packages are independently versioned and published under the `@codelitdev` scope; CourseLit, SendLit, FrontLit, and MediaLit consume registry releases rather than workspace source.

See [the architecture](docs/architecture.md) for package boundaries and [the adopter guide](docs/adopters.md) for product update policy.

## Current packages

| Directory                       | Package                            |
| ------------------------------- | ---------------------------------- |
| `packages/billing`              | `@codelitdev/billing`              |
| `packages/oauth-server-kit`     | `@codelitdev/oauth-server-kit`     |
| `packages/design-system`        | `@codelitdev/design-system`        |
| `packages/platform`             | `@codelitdev/platform`             |
| `packages/observability`        | `@codelitdev/observability`        |
| `packages/mcp-server-kit`       | `@codelitdev/mcp-server-kit`       |
| `packages/platform-conformance` | `@codelitdev/platform-conformance` |
| `packages/platform-cli`         | `@codelitdev/platform-cli`         |

The executable specification lives at `examples/reference-product`. Bootstrap template: `templates/saas-product`.

## Development

```sh
bun install
bun run format:check
bun run verify
```

`bun run verify` runs package linting, type checks, Bun tests, builds, and packed-public-artifact checks.

## Releases

Add a Changeset for every publishable package change:

```sh
bun run changeset
```

Merging to `main` creates or updates the Changesets release pull request. Merging that pull request publishes affected stable packages on the `latest` npm tag. Package versions are independent; publishing one package does not force an unrelated package release.
