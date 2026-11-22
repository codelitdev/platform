---
"@codelitdev/design-system": minor
---

Make the shadcn registry installable with the CLI and pin it to releases.

- Every registry component now installs into `<ui alias>/codelit/` (for example `components/ui/codelit/button.tsx`), so it no longer overwrites a stock shadcn component. Requires shadcn CLI 4.21.0 or later.
- The built registry (`public/r`) ships in the npm package. Point `components.json` at `https://cdn.jsdelivr.net/npm/@codelitdev/design-system@<version>/public/r/{name}.json` with the same version as your npm dependency.
- The registry JSON is rebuilt from the current component sources.
