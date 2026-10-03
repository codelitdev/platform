# @codelitdev/platform-cli

Create a CodeLit Platform product, check its Platform configuration, and keep
its CLI-managed files current. The CLI runs locally in the product repository;
it does not deploy the product or run its conformance tests.

## Commands

| Command | Where to run it | What it does |
| --- | --- | --- |
| `bunx @codelitdev/platform-cli create my-product` | From the parent directory | Creates a product in a new or empty `my-product` directory from the packaged template. |
| `bunx @codelitdev/platform-cli doctor` | From a product root | Checks its `.codelit-platform.json` manifest, managed-file hashes, and resolved package versions against the compatibility preset bundled with this CLI release. |
| `bunx @codelitdev/platform-cli sync --dry-run` | From a product root | Reports the managed files `sync` would write and any conflicts, without writing. |
| `bunx @codelitdev/platform-cli sync` | From a clean Git worktree | Rewrites the managed files from this CLI release's template and updates the manifest. |

Pin the CLI version in automated workflows and use a frozen product lockfile.
`create` copies the template and pins its CodeLit dependencies to the preset's
recommended versions; it does not install dependencies or create a lockfile.
After creation, install dependencies in the new product, review its
configuration, and commit the lockfile.

## Managed and product-owned files

`create` records a `.codelit-platform.json` manifest with the product's name
and slug, the CLI version, declared capabilities, and exact hashes
of the CLI-managed files. Today that is one file,
`.github/workflows/platform-conformance.yml`.

Everything else, including `.github/workflows/code-quality.yml`, belongs to
the product after `create`. The CLI never changes product-owned files.

`doctor` is read-only. It prints a JSON report such as
`{"ok":true,"issues":[]}` and exits nonzero when issues exist. A successful
check says nothing about product behavior.

## Sync

All `@codelitdev/*` packages release together under one version. To move a
product to a release, update its Platform dependencies, then run that
release's `sync`:

```sh
bunx @codelitdev/platform-cli@0.2.0 sync --dry-run
bunx @codelitdev/platform-cli@0.2.0 sync
```

`sync` renders each managed file from the template shipped with the CLI. It
replaces a file only when its hash still matches the manifest, and creates a
newly managed file only when it is absent or already identical. Any other
difference is a conflict: nothing is written, and you reconcile the file by
hand. Writes require a clean Git worktree; `--dry-run` works in a dirty one. If
writing fails, the CLI restores the files it changed.

When a release requires changes to product-owned files, its release notes say
so; apply them yourself. Manifests written by earlier CLI releases
(`schemaVersion: 1`) are migrated on the next `sync`.

## CI

`create` writes two workflows:

- `platform-conformance.yml` (managed): runs `doctor` with the exact CLI
  version that wrote the file, the API package's `check:drift`, and its
  `test:conformance` script. The job fails if the API package has no
  `test:conformance` script. Make it a required pull-request check, and gate
  Platform update pull requests on it.
- `code-quality.yml` (product-owned): lint, typecheck, test, and build. Edit
  it freely.

`create` also writes a product-owned `.github/dependabot.yml` that opens one
grouped pull request per Platform release.

`doctor` checks configuration and compatibility; conformance checks the
running product's behavior.

The package also exports `createProduct`, `doctor`, and `syncProduct` for
programmatic use. Their options and return types are declared in `dist`.
