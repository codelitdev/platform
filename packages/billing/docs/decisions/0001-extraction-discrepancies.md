# ADR 0001: Resolve architecture §20 PRD vs SendLit discrepancies

Status: accepted  
Default: SendLit implemented behavior, except where a correctness defect is named.

| #   | Topic                   | Package decision                                                                                                                         |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cancellation recovery   | `cancelled` may transition to `trialing`, `active`, or `past_due` (provider recovery before paid-through expiry). `expired` is terminal. |
| 2   | Pending status          | Canonical status includes `pending`.                                                                                                     |
| 3   | Envelope vs snapshot    | `VerifiedWebhookEnvelope` is wake-up evidence; `SubscriptionSnapshot` is retrieved truth.                                                |
| 4   | Catalog availability    | Pending/invalid requested revision freezes checkout only. Last verified revision stays the active commercial projection.                 |
| 5   | Provider cancellation   | Adapter requires `cancelSubscription`.                                                                                                   |
| 6   | Metadata                | Allowlisted keys are `checkoutAttemptId` and `catalogKey`. No `sendlit*` keys.                                                           |
| 7   | Clock                   | Decision functions and adapters take an injected `Clock`. Core never reads wall time.                                                    |
| 8   | Reconciliation claims   | Durable `billing_reconciliation_jobs` leases. No row lock spans a provider call.                                                         |
| 9   | Catalog failure         | Last verified revision remains `active`. Requested pending/invalid/abandoned revision makes `checkoutAvailable=false`.                   |
| 10  | Existing-schema mapping | Config may remap table/column names; generator does not invent parallel tables.                                                          |
| 11  | Config loading          | `billing.config.ts` is a pure schema description; generate does not connect to a DB or read provider secrets.                            |
| 12  | Plan constraints        | Configured `planIds` become generated check constraints (schema SemVer).                                                                 |
| 13  | Catalog provenance      | Subscriptions persist `catalogRevision` + offer key + price entry; lineage updates only from correlated checkout/change attempts.        |
| 14  | Projection idempotency  | **Correctness defect vs SendLit.** Equivalent snapshots update freshness only. Material change increments `projectionVersion` once.      |
| 15  | Snapshot time           | `providerOccurredAt` / `providerVersion` are distinct from `observedAt`. Retrieval time is not provider event time.                      |
| 16  | Payer invariant         | Workflows compare persisted payer on customer/attempt/subscription. A fresh grant cannot substitute a different payer.                   |
| 17  | Action grant            | Opaque single-use `BillingAuthorizationPort.consume`. Webhooks/reconciliation cannot present a human grant.                              |
| 18  | Operator audit          | Mutating operator APIs require `OperatorContext` and the audit hook. Decrypt is a separate audit.                                        |
| 19  | Read models             | Export `PublicBillingCatalog` and `CommercialBillingState` only. Product entitlements stay outside.                                      |
| 20  | Mutation recovery       | Each mutation declares `idempotency_key` \| `lookup` \| `unsupported`. Contract tests inject side-effect-then-timeout.                   |
| 21  | Plan-state              | Canonical row is `billableEntityId`, nullable `activeSubscriptionId`, `projectionVersion`. No Free plan column.                          |
| 22  | Required audit hook     | Cloud composition without an audit hook is a composition error.                                                                          |
