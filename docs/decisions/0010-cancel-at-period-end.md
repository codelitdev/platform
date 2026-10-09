# ADR 0010: Cancel subscriptions at the end of the paid period

Status: accepted  
Date: 2026-10-07

## Context

The engine already modelled a cancellation that keeps paid access until the
period ends: `retainsPaidEntitlement` keeps a cancelled subscription as the
entitlement source while `cancelAtPeriodEnd` is set and `paidThroughAt` is
in the future, `runDeadlineBatch` removes it afterwards, and
`commercialState` exposes both fields.

The Dodo adapter did not use it. `cancelSubscription` sent
`status: "cancelled"` with `cancel_at_next_billing_date: false`, which ends
the subscription immediately. A customer who cancelled lost the rest of the
period they had paid for, and products had no end date to show.

## Decision

- `cancelSubscription` schedules cancellation at the end of the paid period
  for every caller, including `operatorCancel`. The subscription keeps its
  status and reports `cancelAtPeriodEnd: true` until the provider ends it.
  The Dodo adapter sends `cancel_at_next_billing_date: true`.
- Provider adapters gain `resumeSubscription`, and the engine gains
  `resumeCancellation`, which clears a scheduled cancellation. It consumes a
  `cancellation` grant, because it reverses that action, so products need no
  new grant type.
- `cancel` and `operatorCancel` treat a subscription that is already
  scheduled to cancel as done.
- Provider idempotency keys for cancel and resume include the subscription's
  provider version. Cancelling again after a resume is then a new request,
  while retries of the same request reuse the key.
- Resuming turns a pending `cancellation` reconciliation job into a plain
  `reconcile` job, so a retry cannot cancel the subscription again.
- Ending a subscription immediately is left to the provider's dashboard.
  Supporting it in the engine would add a reconciliation operation, which
  changes the generated schema of every product.

## Consequences

- No schema change. Products keep the reconciliation operations
  `reconcile` and `cancellation`.
- Products show the end date from `commercialState().paidThroughAt` while
  `cancelAtPeriodEnd` is true, and offer `resumeCancellation`. Starting a
  new checkout to "resume" is wrong while the old subscription is still
  active.
- Custom provider adapters must implement `resumeSubscription`, and their
  `cancelSubscription` must schedule rather than end the subscription. The
  provider contract tests check both.
