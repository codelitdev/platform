# ADR 0003: Template ownership and managed files

Status: accepted; partly superseded by ADR 0006  
Date: 2026-09-02

## Context

Generated applications must remain ordinary TypeScript repositories.
Automatic re-merge of a newer template into product-owned files is a
non-goal (architecture §3, §4.1, §7).

## Decision

- Long-lived behavior lives in independently versioned packages.
- `templates/saas-product` is thin: composition, configuration, examples,
  and explicit application-owned seams.
- `.codelit-platform.json` enumerates hashed managed files. The CLI may
  replace a managed file only when its current hash matches the hash from
  the previous Platform operation. A mismatch is a conflict.
- Product-owned globs (including `apps/**` and `packages/api-contract/**`)
  change only through a named semantic codemod or a migration guide.
- Existing applications never merge the template again.

Phase 1 creates `examples/reference-product` only. The distributable
template and CLI are Phase 5 and must not be claimed earlier.

## Consequences

- Auth, MCP, observability, and billing improvements arrive as package
  releases.
- Source-shape changes arrive as explicit, tested, fail-closed codemods.
- The reference product is the executable specification; the template is
  derived from it after that specification exists.
