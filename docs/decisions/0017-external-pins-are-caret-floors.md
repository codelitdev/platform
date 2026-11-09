# ADR 0017: External preset pins are caret floors

Status: accepted; amends ADR 0002 and ADR 0006  
Date: 2026-11-09

## Context

`doctor` required each external dependency in the preset (`next`, the MCP
SDK, and others) to resolve to exactly the pinned version. When Next.js
16.3.6 picked up critical RCE advisories fixed in 16.4.1, product
dependency-audit pull requests that took the fix failed the platform
conformance check (issue #14). A product could stay conformant or take the
security fix, not both, until the platform shipped a new CLI release.

## Decision

- An `external` pin is still the exact version `create` writes into a new
  product and the version the template declares (`sync-preset.mjs` is
  unchanged).
- `doctor` treats it as a caret floor: a resolved version passes if it is
  at or above the pin on the same major line (same minor while the major
  is 0). Older versions and the next breaking line still fail as
  `external_mismatch`.
- When an advisory affects a pinned external, raise the template's pin to
  the patched version so `doctor` rejects the vulnerable release.

## Consequences

- Products take patch and minor security fixes through Dependabot without
  waiting for a platform release.
- Conformance no longer proves a product runs the exact external versions
  the template was tested with. Minor releases of mature dependencies are
  trusted to be compatible; a major upgrade still requires a preset change.
