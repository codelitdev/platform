# design-sync notes — @codelitdev/design-system

- **Repo history**: this package was first authored inside the SendLit monorepo
  at `sendlit/packages/design-system/` (as a `workspace:*` dep of `apps/web`),
  then extracted to its own standalone repo
  (`git@github.com:codelitdev/design-system.git`) on 2026-07-25 and published to
  npm as a public Apache-2.0 package so all four CodeLit products (CourseLit,
  MediaLit, SendLit, FrontLit — all live today) can consume it. First publish was
  `0.1.0-alpha.0` under the `alpha` dist-tag. Older notes below may say "this
  repo" / "the SendLit repo" interchangeably — they mean this package.
- **Three distinct outputs from this one repo — don't conflate them:**
  1. **npm package** (`src/`, `tailwind-preset.js`) — tokens + Tailwind preset +
     plain-React reference components. Consumed CSS-only by the apps.
  2. **claude.ai/design sync** (the `.design-sync/` tooling + Claude Design
     project "CodeLit Products") — uploads the DS so the design agent designs
     with it. Direction: repo → Claude Design.
  3. **shadcn registry** (`registry/codelit/ui/*.tsx` → built to `public/r/*.json`
     via `pnpm registry:build`, i.e. `shadcn build`) — real shadcn/Radix
     components styled to the DS spec, installed into the apps via
     `npx shadcn add @codelit/<name>`. This is how the four products share ONE
     component layer (added 2026-07-25: button, badge, card so far). The
     registry components pull their look from the DS tokens (they assume
     `@codelitdev/design-system/styles.css` is imported) and use raw-var
     arbitrary utilities (`bg-[var(--primary-soft)]`) for product-scoped tokens
     so they resolve at use-time under `data-product`. `public/r/*.json` is a
     BUILT-but-COMMITTED artifact (the raw-URL install serves it) — rebuild +
     commit when a `registry/` source changes.
- **`data-product` goes on `<html>`, not `<body>`** (README step 3 fixed
  2026-07-25). Root cause of a real bug in SendLit: `--sidebar-primary:
  var(--primary)` declared at `:root` freezes to base amber when the
  `data-product` override sits on `<body>` (a child), because a custom
  property's `var()` resolves at the element the declaration applies to. Direct
  `bg-primary` still went green → confusing amber-avatar/green-button split.
  Putting `data-product` on `<html>` (= `:root`) fixes all such `:root` token
  indirections at once.
- No build step for the npm package itself: the `scripts` are `release:alpha`
  (publish helper) and `registry:build` (shadcn registry, unrelated to the npm
  tarball), and
  `main`/`types`/`exports['.']` all point straight at `src/index.ts` (raw
  TypeScript, compiled inline by whichever app consumes it). The converter is
  pointed at `--entry ./src/index.ts` directly rather than a `dist/` build —
  confirmed with the user at sync time, not guessed.
- Every component ships a hand-authored `<Name>.prompt.md` sibling (e.g.
  `src/components/actions/Button.prompt.md`) written in the same voice/format
  design-sync itself would generate — these came from the original Claude
  Design authoring of this system. The sibling-doc auto-discovery only matches
  `<Name>.md`/`<Name>.mdx` (exact filename), so `.prompt.md` siblings are
  invisible to it — hence the full `docsMap` in config.json pinning all 13
  components to their existing `.prompt.md` files. This is a real gap in
  discovery for this repo's convention, not a lazy enumeration: don't remove
  it on a future re-sync without re-checking the sibling-match logic.
- These `.prompt.md` files are also the primary composition source for
  authored previews (design-sync §4.2 "curate before inventing") — each one
  already has a canonical JSX usage snippet.
- `cssEntry` copies its target file verbatim — it does NOT resolve local
  `@import`s. This repo's real `src/styles.css` is an @import-only manifest
  (fonts.css, colors.css, products.css, typography.css, layout.css,
  components.css) with no separate tokens package, so neither `cssEntry`
  alone nor `tokensGlob`/`tokensPkg` (which require a separate npm package)
  applied cleanly. Fix: a synthesized single file at
  `.design-sync/.cache/compiled-styles.css` — the same files concatenated in
  their original `@import` order (fonts.css first, since it itself starts
  with a remote Google Fonts `@import url(...)` that must stay first for CSS
  validity) — with `cssEntry` pointed at that. This file is regenerated, not
  committed (`.cache/` is gitignored); re-sync must regenerate it before
  building if any of the 6 source files changed. There is no automation for
  this yet — a future re-sync should re-run the same `cat` concatenation (see
  git history for the exact command) before invoking the converter, or a
  small script could be added to `.design-sync/` to do it automatically.
- Devdependencies added to `packages/design-system/package.json` to support
  the sync (all legitimate, low-risk additions — not sync-only cruft):
  `@types/react` (ts-morph prop extraction needs it — the converter's own
  `[DTS_REACT]` fix), `lucide-react@^0.544.0` (previews for IconButton/
  Tooltip needed a real icon, matching what `apps/web` already uses).
- `playwright` (latest, pins chromium build 1228 which matched the machine's
  pre-existing cached chromium) and `typescript` installed into the isolated
  `.ds-sync/node_modules` for the render check and `.d.ts` syntax check.
- Known benign warning: `package-validate.mjs`'s `.d.ts` TypeScript syntax
  check always prints "(.d.ts parse check skipped — typescript not in
  node_modules)" even with `typescript` installed in `.ds-sync/node_modules`
  — root cause is an ESM/CJS interop issue (`await import('typescript')`
  succeeds but named exports like `createSourceFile` come back `undefined`,
  which then throws and gets caught by the surrounding try/catch). Harmless:
  the check is explicitly best-effort/non-blocking, and the real `.d.ts`
  extraction (ts-morph, at build time) already succeeded 13/13 with no
  `[DTS_PARSE]` errors. Not fixed (would require forking a top-level script
  for a cosmetic message).
- `Dialog` needed `cfg.overrides.Dialog: {"cardMode": "single", "viewport":
  "480x420"}` — its scrim uses `position: fixed`, which escapes normal grid
  flow.
- All 13 components authored solo (no subagent fan-out) — small set (13
  components), so the full "solo first, then fan out" wave process wasn't
  needed.
- **Preview cards render in CodeLit base amber, not any product's accent —
  this is a deliberate decision, not a bug.** This DS is multi-product:
  `products.css` scopes `--primary`/`--primary-*`/`--ring` per
  `data-product="courselit|medialit|sendlit|frontlit"` on an ancestor, and
  with no attribute `--primary` falls back to `--brand-amber`
  (`oklch(0.66 0.14 60)`). The generated preview shell emits a bare `<body>`
  with no attribute, so cards show amber while e.g. SendLit's real UI is green
  (`oklch(0.6 0.14 150)` / `#319751`). Confirmed with the user on the first
  sync (2026-07-25): keep the cards product-neutral, since the project covers
  all four products. Do NOT "fix" this on a re-sync by scoping the previews.
  The risk it creates — an agent that forgets `data-product` silently shipping
  amber product UIs — is mitigated in `conventions.md`, which states the
  attribute is required when building for a specific product and warns not to
  infer accents from the cards. Keep that warning intact.
- design-sync's preview shell has no config hook for `<body>` attributes
  (checked: no `bodyAttrs`/`htmlAttrs` anywhere in lib/), and `lib/emit.mjs`
  must not be forked (it's the output contract with the app's self-check). So
  if cards ever DO need product scoping, the options are wrapping each
  authored preview's JSX in a `<div data-product="…">`, or exporting a real
  `ProductScope` component from the DS and wiring it via `cfg.provider`.

## Re-sync risks

- If this package ever gains a real build step (dist/ + compiled .d.ts),
  `--entry` should be repointed there — the raw-TS entry mode extracts prop
  types via ts-morph reading source directly, which is fine here but would be
  redundant/inconsistent with a proper build.
- The `docsMap` above is a full enumeration by necessity (see above) — if
  sibling-doc discovery ever adds `.prompt.md` support upstream, this map
  becomes redundant and could be dropped.
- `.design-sync/.cache/compiled-styles.css` (the `cssEntry` target) is
  regenerated, not committed — if any of the 6 source CSS files it
  concatenates change without a re-sync regenerating it first, the uploaded
  bundle silently ships stale styles. A re-sync must regenerate it (see the
  note above) before running the build/driver.
- `previews/` (13 files) compose against the current component APIs — if a
  component's props change shape, the affected preview(s) may need updating
  even though this NOTES.md won't automatically flag which ones.
- **Publish gotcha #1**: npm 11.x does NOT honor `publishConfig.tag`, so a bare
  `npm publish` lands a prerelease on the `latest` dist-tag (verified on npm
  11.6.0 — dry-run printed "with tag latest" despite `publishConfig.tag:
  alpha`). Always publish via `npm run release:alpha` (forces `--tag alpha`)
  or an explicit `npm publish --tag alpha`. `publishConfig.access: public` IS
  honored. When a stable release is eventually cut, THAT one goes to `latest`
  via a plain `npm publish` (no `release:alpha`).
- **Publish gotcha #2 (bigger, unavoidable)**: npm ALSO sets `latest` on a
  package's very first publish regardless of `--tag` — confirmed after
  publishing `0.1.0-alpha.0` with `--tag alpha` (2026-07-25):
  `npm view @codelitdev/design-system dist-tags` showed
  `{ alpha: '0.1.0-alpha.0', latest: '0.1.0-alpha.0' }`. There is no flag to
  suppress this on a first publish, and `npm dist-tag` can only repoint
  `latest` to an EXISTING version — there was no other version to repoint it
  to. Net effect: right now a bare `npm install @codelitdev/design-system`
  (no version, no tag) resolves to the alpha, exactly what the `alpha` tag was
  meant to prevent. Consumers (CourseLit/MediaLit/FrontLit/SendLit) must pin
  the exact version until a stable release exists.
  **Correction (verified 2026-07-25 publishing `0.1.0-alpha.1`):** this does
  NOT self-resolve on the next publish. A subsequent `--tag alpha` publish
  moves only `alpha`; `latest` stayed pinned at `0.1.0-alpha.0`, i.e. a bare
  `npm install` then fetched the OLDER alpha, and npmjs.com kept rendering the
  stale README. Once ≥2 versions exist the tag is repointable, so fix it
  explicitly after each prerelease:
      npm dist-tag add @codelitdev/design-system@<new-version> latest
  `latest` only becomes truly correct when a stable version is published and
  takes it. Until then, keep the README warning banner in place.

- **Bug fixed 2026-07-25 (0.1.0-alpha.2): global `a`/`a:hover` styling removed
  from `tokens/typography.css`.** It set `text-decoration: underline` on hover
  for EVERY bare `<a>`/framework `<Link>` in any consuming app — broke nav
  items, sidebar links, and clickable cards in SendLit (`apps/web`) the
  instant `styles.css` was imported, since nothing in that app opted out and
  shadcn's own convention (`Button`'s `link` variant) already handles the
  "I want an underlined link" case as an explicit opt-in. Replaced with a
  `.cl-link` class (same colors/hover, but opt-in only) for prose-style inline
  links. This shipped in 0.1.0-alpha.0/alpha.1 too — any app that imported
  `styles.css` before alpha.2 had this bug, not just SendLit.

- **Gap found 2026-07-26 (0.1.0-alpha.3): `assets/loader-<product>.svg` references
  an undefined animation.** Each loader SVG sets
  `style="animation:cl-draw 1.8s ease-in-out infinite"` on its stroke paths
  (with `stroke-dasharray="200"` set up for a draw-in effect), but no
  `@keyframes cl-draw` is defined anywhere in the package's shipped CSS
  (checked `src/components.css`, `src/styles.css`, `src/tokens/*.css` — none
  of them declare it). Used as shipped, the SVG renders as a static mark, not
  an animated loader — the `animation` property is simply a no-op without a
  matching `@keyframes`. SendLit (`apps/web`) worked around this by using the
  SVG as a static icon (`components/dashboard/loading.tsx`) rather than
  guessing at the intended keyframes. Fix upstream: add `@keyframes cl-draw`
  (a stroke-dashoffset sweep matching the `stroke-dasharray="200"` setup) to
  `src/components.css` or a new `src/tokens/motion.css`, bump to alpha.4, and
  update consumers to get the real animation.

- **Fixed 2026-07-26 (0.1.0-alpha.4): the `cl-draw` gap above was fixed via a
  new `<Loader>` component, not a static SVG + CSS keyframe.** `assets/
  loader-*.svg` (5 files) are deleted — do not reintroduce them. Reasoning:
  the dead SVGs were meant to be dropped in via `<img src="...">` (see
  SendLit's original `loading.tsx` workaround), which sandboxes out the
  page's CSS entirely — a bare `@keyframes cl-draw` in `components.css`
  would only ever animate an *inlined* copy of the SVG, never one loaded via
  `<img>`/`next/image`. `<Loader product="..." size={...} />`
  (`src/components/feedback/Loader.tsx`, exported from `src/index.ts` along
  with `LoaderProps`) renders real inline `<svg>`/`<path>` markup so
  `.cl-loader__path { animation: cl-draw ... }` (now actually defined, in
  `components.css`) applies directly. Draws the product's own logo mark
  (petals in sync), not a generic spinner. Colors via `currentColor` like an
  icon component — no per-product color is baked in, so consumers wrap it
  (or an ancestor) in whatever sets the color they want (e.g.
  `className="text-primary"` for the scoped product accent under
  `data-product`). If a future re-sync is tempted to add
  `assets/loader-*.svg` back (e.g. because design-sync's asset scraping
  finds them in an old branch), don't — the component is the source of
  truth now.

- **Bug fixed 2026-07-26 (0.1.0-alpha.5): `Tabs.tsx` (plain-React reference
  component) had an implicit-`any` parameter** (`const pick = (t) => {`,
  no type — `tabs.map((t) => ...)` a few lines below is fine since array
  methods get contextual typing from the array's element type, but a bare
  `const x = (t) => {}` assignment has nothing to infer from). Harmless by
  itself, but because `main`/`types` point straight at raw `src/index.ts`
  (no build step — see the no-build-step note above), importing ANY named
  export from `@codelitdev/design-system` pulls in the whole barrel file,
  and `tsc` type-checks the entire re-export graph — including components
  a consumer never actually uses. This had shipped unnoticed since the
  package's original authoring because no consumer had ever imported a
  named JS export before (SendLit only ever did `@import
  ".../styles.css"`, a CSS-only import that never touches the JS/TS module
  graph). First surfaced when SendLit imported `{ Loader }` for the
  alpha.4 fix above. **Lesson for future components in `src/`:** every
  file in the barrel is load-bearing for every consumer's typecheck the
  moment ANYTHING is imported by name, not just what that consumer
  actually uses — a stray implicit-any anywhere in `src/components/`
  breaks every app pinned to that version.

- **Bug fixed 2026-07-26 (0.1.0-alpha.6): `Dialog.tsx` imported
  `"../actions/Button.jsx"` — wrong extension; the real file is
  `Button.tsx`, there is no `.jsx` sibling anywhere in `src/`. `tsc` never
  caught this (bare/`.jsx`-suffixed specifiers both resolve fine under
  `moduleResolution: bundler`), so it shipped in alpha.5 undetected by
  typecheck. Surfaced the moment SendLit's Next.js/Turbopack dev server
  actually bundled the package at runtime (needed `transpilePackages:
  ["@codelitdev/design-system"]` in `next.config.mjs` first, to get past
  a separate "Unknown module type" error from Turbopack trying to bundle
  raw `.ts`/`.tsx` from `node_modules` without transpilation — see the
  no-build-step note above). **Lesson:** `tsc --noEmit` on a consumer is
  not sufficient to catch broken relative import paths in this package;
  a real bundler run (dev server or build) is needed to catch these before
  publishing.

- **Added 2026-07-26 (0.1.0-alpha.6): `npm run check`** (`tsc --noEmit` +
  an `esbuild` bundle of `src/index.ts`) plus `typescript`/`esbuild`/
  `react`/`react-dom`/`@types/react-dom` devDependencies and a root
  `tsconfig.json` (strict, `moduleResolution: bundler`, matching
  consumer apps' settings) — none of this existed before, which is why
  both bugs above shipped across two publishes with nobody able to
  catch them locally. `release:alpha` now runs `check` first. The
  esbuild step matters specifically because `tsc`'s `bundler` resolution
  is lenient about wrong extensions (see the `Dialog.tsx` bug above);
  esbuild does real filesystem resolution like Turbopack/webpack do, so
  it catches that class of bug that `tsc` alone won't.

- **Also fixed 2026-07-26 (0.1.0-alpha.6): missing `"use client"` on
  every component that attaches an event handler prop (`onClick`/
  `onChange`) directly to a DOM element, or uses a hook** — `Button`,
  `IconButton`, `Dialog`, `Radio`, `Checkbox`, `Switch`, `Select`,
  `Input`, `Tabs`, `Tooltip`. Not something `tsc`/`esbuild` can catch —
  only bites when a consumer imports one of these directly into a
  React Server Component (no `"use client"` ancestor), where Next.js
  throws `Event handlers cannot be passed to Client Component props`
  (or, for `Tabs`/`Tooltip`, the hook-only-in-Client-Component error)
  at build time. Every current SendLit usage happens to already be
  inside a `"use client"` page, so this hadn't surfaced yet — added
  proactively before another product (CourseLit/MediaLit/FrontLit)
  hits it from a Server Component. `Badge`, `Card`, `Loader`, `Toast`
  have no event props and stay server-renderable.
