# @codelitdev/design-system

## 0.15.0

### Patch Changes

- e40786b: Registry `dialog`: `DialogHeader` now leaves 20px before the dialog body, matching the design spec. Previously the body sat flush under the description.

## 0.14.1

No changes in this release.

## 0.14.0

### Minor Changes

- 3a2a0bf: Make the shadcn registry installable with the CLI and pin it to releases.
  
  - Every registry component now installs into `<ui alias>/codelit/` (for example `components/ui/codelit/button.tsx`), so it no longer overwrites a stock shadcn component. Requires shadcn CLI 4.21.0 or later.
  - The built registry (`public/r`) ships in the npm package. Point `components.json` at `https://cdn.jsdelivr.net/npm/@codelitdev/design-system@<version>/public/r/{name}.json` with the same version as your npm dependency.
  - The registry JSON is rebuilt from the current component sources.

## 0.13.0

No changes in this release.

## 0.12.0

No changes in this release.

## 0.11.0

No changes in this release.

## 0.10.0

No changes in this release.

## 0.9.0

No changes in this release.

## 0.8.2

No changes in this release.

## 0.8.1

No changes in this release.

## 0.8.0

No changes in this release.

## 0.7.0

No changes in this release.

## 0.6.0

No changes in this release.

## 0.5.0

No changes in this release.

## 0.4.2

No changes in this release.

## 0.4.1

No changes in this release.

## 0.4.0

No changes in this release.

## 0.3.0

No changes in this release.

## 0.2.0

No changes in this release.

## 0.1.0

### Patch Changes

- Publish the existing Design System package as a stable release.
