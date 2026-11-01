---
"@codelitdev/platform-cli": patch
---

The preset and product template now pin `next` 16.4.3 and Bun 1.4.4, the patched releases, so `doctor` no longer fails products that already moved to them. `sync` also records a managed file that was reconciled by hand to the template instead of reporting it as a conflict.

## Product changes

- Use `next` 16.4.3 and Bun 1.4.4 (`packageManager`, CI `bun-version`, `@types/bun` 1.4.4).
- Run `bunx @codelitdev/platform-cli@<this version> sync`. If it reports `platform-conformance.yml` as a conflict, make that file match this release's template, then run `sync` again.
