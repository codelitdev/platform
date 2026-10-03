# ADR 0004: Release and support policy

Status: accepted; partly superseded by ADR 0006  
Date: 2026-09-02

## Context

The monorepo coordinates CI and publishing but must not impose lockstep
versions. Products consume immutable published packages, never unpublished
workspace source (architecture §5, §11).

## Decision

- Independent package versions via Changesets. A Changeset bumps only
  affected packages and dependants whose published contract or
  compatibility declaration changed.
- SemVer: patch = behavior-preserving fix or diagnostic; minor = additive
  API, opt-in capability, or idempotent codemod; major = removed contract,
  changed security meaning, or required product/migration work.
- Release path: package tests → reverse-dependency tests → packed public
  exports → reference product → origin-product canary → publish →
  compatible preset → automated adopter PR → adopter tests and
  conformance.
- Support lines and end-of-support dates are recorded in
  `docs/compatibility.md` when the preset exists (Phase 4). Prerelease tags
  are unsupported for production except by explicit origin-canary agreement
  (SendLit for billing).
- Security: the affected package publishes a patch; the preset records
  recommended and minimum-secure versions; adopter PRs are expedited.
  Critical fixes may use coordinated disclosure; they are never silently
  pushed into product repositories.

## Consequences

- `@codelitdev/billing` remains independently releasable; SendLit is its
  origin canary.
- Cross-product billing contracts stay experimental until CourseLit is
  the second consumer.
- An extracted abstraction is not stable until its origin product
  consumes the published artifact.
