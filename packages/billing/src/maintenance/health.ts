import type { Clock } from "../core/clock.js";
import type { BillingStore } from "../persistence/store.js";

export type BillingHealthFacts = {
  oldestInboxAgeMs: number | null;
  quarantinedWebhooks: number;
  quarantinedJobs: number;
  stuckCreatingCheckouts: number;
  stuckCreatingCustomers: number;
  unreconciledSubscriptions: number;
  invalidRequestedCatalog: boolean;
};

export async function healthFacts(
  store: BillingStore,
  clock: Clock,
  requestedRevision: number | null,
  checkoutProvider?: string,
): Promise<BillingHealthFacts> {
  const now = clock.now();
  const snapshot = await store.health(now, checkoutProvider);
  const oldest = snapshot.oldestPendingInboxOccurredAt
    ? now.getTime() - snapshot.oldestPendingInboxOccurredAt.getTime()
    : null;
  return {
    oldestInboxAgeMs: oldest,
    quarantinedWebhooks: snapshot.quarantinedWebhooks,
    quarantinedJobs: snapshot.quarantinedJobs,
    stuckCreatingCheckouts: snapshot.stuckCreatingCheckouts,
    stuckCreatingCustomers: snapshot.stuckCreatingCustomers,
    unreconciledSubscriptions: snapshot.unreconciledSubscriptions,
    invalidRequestedCatalog:
      requestedRevision !== null &&
      (snapshot.activeRevision !== requestedRevision ||
        snapshot.activeRevision === null),
  };
}
