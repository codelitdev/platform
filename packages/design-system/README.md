# @codelitdev/design-system

Shared tokens, Tailwind preset, and React primitives for CourseLit, MediaLit, SendLit, and FrontLit.

Apps get the tokens and Tailwind preset from this npm package, and the
components from its shadcn registry (see step 5). The plain-React components
exported from `src/index.ts` are reference/fallback, except `Loader`.

## Install

Published to npm as a public package. The current release line is a prerelease
under the `alpha` dist-tag.

> [!WARNING]
> **`latest` currently also points at `0.1.0-alpha.0`.** npm always sets
> `latest` on a package's first-ever publish, regardless of `--tag` — this is
> unavoidable until a real stable version is cut, at which point publishing it
> moves `latest` forward automatically. Until then, **always pin the exact
> version** — do not `bun add @codelitdev/design-system` bare, and do not
> use a caret/tilde range (`^0.1.0-alpha.0` would still resolve to a
> prerelease, which is at least explicit — but a bare install with no version
> silently means "whatever `latest` is," which right now is this alpha).

```sh
bun add @codelitdev/design-system@0.1.0-alpha.6
```

Platform examples consume the package as `workspace:*`. Product repositories
consume an exact published version.

## Use in a shadcn app

1. Import the token layer once, e.g. in `app/globals.css`:
```css
@import "@codelitdev/design-system/styles.css";
```
This replaces the default shadcn `:root`/`.dark` block — variable names match, so existing shadcn components need no code changes.

2. Extend your Tailwind config:
```js
// tailwind.config.js
const codelitPreset = require("@codelitdev/design-system/tailwind-preset");
module.exports = {
  presets: [codelitPreset],
  content: [...],
};
```

3. Scope the product on the **`<html>`** element (not `<body>`):
```tsx
<html data-product="sendlit">  {/* courselit | medialit | sendlit | frontlit, omit for CodeLit amber */}
```
> [!IMPORTANT]
> Put `data-product` on `<html>`, not `<body>`. The product scope only overrides
> `--primary`/`--ring`; any token you alias at `:root` that references `--primary`
> (e.g. shadcn's `--sidebar-primary: var(--primary)`) resolves that `var()` **at the
> declaring element**. If the override sits on `<body>` (a child of `:root`), those
> `:root` aliases freeze to the base amber and never pick up the product accent —
> while direct `bg-primary` utilities still turn green, producing a confusing split.

4. Fonts: load Hanken Grotesk + Spline Sans Mono via `next/font/google` (or your framework's font loader), mapped to `--font-sans` / `--font-mono`.

5. **Components — install from the shadcn registry** (see [Components](#components-shadcn-registry) below). These are real shadcn/Radix components styled to the design system, so your app's buttons/badges/cards *are* the DS's — no hand-porting. The plain-React `src/components/` classes (`components.css`) remain as visual reference only.

6. Logos: `@codelitdev/design-system/assets/logo-<product>.svg`.

7. Loaders — a drawn-from-the-logo spinner, not a static asset:
```tsx
import { Loader } from "@codelitdev/design-system";
<Loader product="sendlit" size={32} />
```
Renders in `currentColor`, same as an icon component — wrap it (or an ancestor) in
whatever sets the color you want, e.g. `className="text-primary"` for the product accent.

## Components (shadcn registry)

The design system ships its components as a **shadcn registry** so every product
installs the *same* styled components (buttons, badges, cards, …) via the shadcn
CLI — keeping all four apps on one component layer instead of each re-styling its
own. They're standard shadcn/Radix components; they pull their look from the DS
tokens, so make sure `@codelitdev/design-system/styles.css` is imported (above).

Products install these components with the shadcn CLI. Do not copy component
files by hand: the CLI is what lets a product re-run `add` to take a fix.

### Setup (once per app)

Add the registry to the app's `components.json`, pinned to the **same exact
version** as the app's `@codelitdev/design-system` dependency:

```jsonc
{
  "registries": {
    "@codelit": "https://cdn.jsdelivr.net/npm/@codelitdev/design-system@0.14.0/public/r/{name}.json"
  }
}
```

The built registry ships inside the npm package (from 0.14.0), so a pinned URL
always serves the same files. When you bump the npm dependency, bump this URL
in the same commit, then re-run `add` for the components you use.

The app also needs the token layer and preset (steps 1–2 above) and a `cn`
helper at its `utils` alias (shadcn's default `@/lib/utils`).

### Install and update

```sh
bunx shadcn@4.21.0 add @codelit/button @codelit/badge @codelit/card
```

Every component installs into `<ui alias>/codelit/`, for example
`components/ui/codelit/button.tsx`, so it never overwrites a stock shadcn
component in `components/ui/`. Import it from there:

```tsx
import { Button } from "@/components/ui/codelit/button";
```

Use shadcn CLI 4.21.0 or later: older versions don't understand the
`@ui/...` install target. To update, re-run `add` with `--overwrite`. That
replaces the file, including any local edits, so review the diff before
committing.

### Available components

| Component | Notes |
|---|---|
| `button` | `primary` / `secondary` / `outline` / `ghost` / **`soft`** / `destructive`; `sm` `md` `lg` (30/36/42px) |
| `icon-button` | Square icon-only; `ghost` / `outline`; `sm` `md` |
| `badge` | `default` / `neutral` / `success` / `warning` / `destructive` / `outline`; `dot` prop |
| `card` | + `CardHeader` `CardTitle` `CardDescription` `CardContent` `CardFooter` |
| `input` | Accent-wash focus ring; `aria-invalid` → destructive |
| `textarea` | Multiline form of `input` |
| `label` | 13px semibold field label |
| `checkbox` | 18px, 5px radius, accent fill when checked |
| `radio-group` | + `RadioGroupItem` |
| `switch` | 36×21 track, accent when on |
| `select` | Trigger matches `input`; token-styled popover |
| `tabs` | Segmented; active trigger lifts onto a card surface |
| `dialog` | Warm scrim, 16px radius; full Radix parts |
| `dropdown-menu` | Matches `select`'s popover treatment; full Radix parts incl. checkbox/radio items and submenus |
| `tooltip` | Dark chip; `TooltipProvider` included |
| `toast` | Presentational card (`default`/`success`/`destructive`) — drive with your own queue |

Install everything at once:

```sh
bunx shadcn@4.21.0 add @codelit/button @codelit/icon-button @codelit/badge @codelit/card \
  @codelit/input @codelit/textarea @codelit/label @codelit/checkbox @codelit/radio-group \
  @codelit/switch @codelit/select @codelit/tabs @codelit/dialog @codelit/dropdown-menu \
  @codelit/tooltip @codelit/toast
```

**Maintainers:** component sources live in `registry/codelit/ui/`. After changing
one, rebuild with `bun run registry:build` (→ `public/r/*.json`) and commit the
result. Every file in `registry.json` needs a `target` under `@ui/codelit/`.
`bun run verify` (via `scripts/check-registry.mjs`) fails when `public/r` is out of
date or a target is missing. Products receive registry changes only through a
published release, so add a Changeset as for any other change.

## Publishing

Prereleases go under the `alpha` dist-tag so a plain `bun add` never grabs
one. Releases are driven from the Platform root through Changesets; do not run
`bun publish` from this package directory:

```sh
bun run changeset
bun run release:alpha
```

Verify: `bun info @codelitdev/design-system --json` should show the
prerelease under `alpha` and leave `latest` untouched.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
