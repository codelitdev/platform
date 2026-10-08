# ADR 0012: Stabilise the billing workflow contracts

Status: proposed  
Date: 2026-10-07

## Context

Architecture §1 keeps the billing package's workflows, action grants,
operator services, and lifecycle hooks experimental until a second consumer
proves the same contracts. Several products are now adopting
`@codelitdev/billing`, and ADRs 0009 to 0011 moved the remaining
lifecycle mechanics into the package. Products need to know which contracts
they can rely on across minor releases.

## Proposal

- Treat these contracts as stable from the next release, changing them only
  with a migration note in the changeset:
  - `createBilling` options, and the workflows `startCheckout`,
    `startPortal`, `startPlanChange`, `cancel`, and `resumeCancellation`.
  - The read models `commercialState`, `publicCatalog`, and `health`.
  - The maintenance batches `runWebhookInboxBatch`, `runReconciliationBatch`,
    `runDeadlineBatch`, and `purgeExpiredSensitiveValues`.
  - The ports `BillingAuthorizationPort`, `SensitiveValuePort`, the audit
    hook, and `lifecycle.afterProjection`.
  - The provider adapter contract, checked by the provider conformance tests.
- Keep experimental: `@codelitdev/billing/operations`, and `billing.store`,
  which is internal (ADR 0011).
- Record the stable surface in the package README and update architecture
  §1 once a second product runs the stable contracts in production.

## Open questions

- Whether "stable" waits for the second consumer named in architecture §1 to
  run these contracts in production, or starts now that several products use
  them.
- Whether stabilising these contracts is the point to move the package to
  1.0, or to keep 0.x with a stricter changeset policy.
