## Setup — no provider, one attribute

This system has no React context/provider. Two things make components render
correctly:

1. **Load `_ds/styles.css`** (or whatever the host bundles it as) — it carries
   every token and component style via its `@import` closure. Nothing renders
   correctly without it.
2. **Scope the product accent** by putting `data-product="<name>"` on `<body>`
   or any ancestor: `courselit` | `medialit` | `sendlit` | `frontlit`. This
   swaps only `--primary`/`--primary-*`/`--ring` — every other token stays the
   same across products.

   **When building for a specific product, this attribute is required, not
   optional.** With no `data-product`, `--primary` falls back to the CodeLit
   house amber (`oklch(0.66 0.14 60)`) — correct only for CodeLit-level
   surfaces. Ship a SendLit screen without it and every button, focus ring and
   accent renders amber instead of SendLit green (`oklch(0.6 0.14 150)`), which
   nothing downstream will flag as wrong.

   Note the preview cards in this pane are deliberately rendered **unscoped**,
   so they show the amber base — they demonstrate each component's structure,
   not any one product's accent. Never infer a product's accent color from the
   cards; set the attribute and let the tokens resolve.

Fonts (Hanken Grotesk + Spline Sans Mono) load via a Google Fonts `@import`
already inside `styles.css` — no extra font setup needed.

## Styling idiom: props in, tokens for your own glue CSS

Components are **prop-driven, not class-driven** — never pass `className` or
write CSS-utility classes against them. Each component's variant/size axes are
real TypeScript unions (e.g. `Button`'s `variant`: `"primary" | "secondary" |
"outline" | "ghost" | "soft" | "destructive"`, `size`: `"sm" | "md" | "lg"`
— see each `<Name>.d.ts`). `soft` (accent-wash) is CodeLit's signature
secondary emphasis — reach for it before inventing a custom treatment.

For layout/spacing glue **around** components (containers, custom gaps), use
the real CSS custom properties rather than arbitrary values:

- **Color** (light/dark aware, redefined per `data-product`): `--background`,
  `--foreground`, `--card`, `--card-foreground`, `--primary`,
  `--primary-foreground`, `--primary-soft`, `--primary-hover`, `--secondary`,
  `--muted`, `--muted-foreground`, `--accent`, `--destructive`,
  `--destructive-soft`, `--success`, `--success-soft`, `--warning`,
  `--warning-soft`, `--border`, `--input`, `--ring`.
- **Spacing** (4px grid): `--space-1` (4px) through `--space-12` (48px) —
  `--space-1/2/3/4/5/6/8/10/12`.
- **Radius**: `--radius` (10px, controls/inputs/buttons), `--radius-sm` (6px,
  chips), `--radius-lg` (16px, cards/dialogs), `--radius-full` (pills).
- **Shadows**: `--shadow-card`, `--shadow-raised`, `--shadow-popover`,
  `--shadow-focus`.
- **Type scale**: `--text-display`, `--text-h1/h2/h3`, `--text-body`,
  `--text-body-sm`, `--text-label`, `--text-caption`, `--text-code`,
  `--text-eyebrow` — each is a full `font` shorthand (weight/size/line-height),
  so `font: var(--text-h2)` sets the whole style in one line.

## Where the truth lives

- `styles.css` and its `@import` closure (tokens for color/spacing/radius/
  type) are the source of every value above — read it before inventing a
  color or spacing value.
- Each component's `<Name>.prompt.md` carries real usage guidance and a
  canonical composition; read it before composing that component.

## Example — the canonical composition

```jsx
<Card
  title="Course details"
  description="Shown on your public page."
  footer={<Button>Save changes</Button>}
>
  <Input label="Course title" placeholder="e.g. Intro to TypeScript" hint="Shown on your public page." />
</Card>
```

For custom layout around components, match the system rather than inventing:

```jsx
<div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
  <Badge variant="success" dot>Published</Badge>
  <Card style={{ borderRadius: "var(--radius-lg)" }}>…</Card>
</div>
```
