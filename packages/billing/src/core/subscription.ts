import type { BillingInterval, CanonicalSubscriptionStatus } from "./ids.js";

export type SubscriptionSnapshot = {
  provider: string;
  providerCustomerId: string;
  providerSubscriptionId: string;
  providerProductId: string;
  status: CanonicalSubscriptionStatus;
  currentPeriodStartsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  paidThroughAt: Date | null;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  providerOccurredAt: Date | null;
  providerVersion: string | null;
  observedAt: Date;
  metadata: {
    checkoutAttemptId?: string;
    catalogKey?: string;
    [key: string]: string | undefined;
  };
};

export type VerifiedWebhookEnvelope = {
  provider: string;
  providerEventId: string;
  eventType: string;
  occurredAt: Date;
  subscriptionId: string | null;
  verifiedKeyVersion: string | null;
  correlationMetadata: {
    checkoutAttemptId?: string;
    catalogKey?: string;
  };
  /** The event belongs to another product on the same provider account. */
  foreign?: boolean;
};

export type CanonicalSubscription = {
  id: string;
  billableEntityId: string;
  payerId: string;
  provider: string;
  providerCustomerId: string;
  providerSubscriptionId: string;
  providerProductId: string;
  catalogRevision: number;
  offerKey: string;
  plan: string;
  interval: BillingInterval;
  priceEntryId: string;
  status: CanonicalSubscriptionStatus;
  currentPeriodStartsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  paidThroughAt: Date | null;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  isEntitlementSource: boolean;
  originCheckoutAttemptId: string | null;
  providerOccurredAt: Date | null;
  providerVersion: string | null;
  lastObservedAt: Date | null;
  lastReconciledAt: Date | null;
};

export const PAID_STATUSES = new Set<CanonicalSubscriptionStatus>([
  "active",
  "trialing",
  "past_due",
]);

/** How long a paid status keeps entitlement past `paidThroughAt` by default. */
export const DEFAULT_ENTITLEMENT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a subscription still grants its paid plan. Every paid status ends at
 * `paidThroughAt` plus `graceMs`, so a lost renewal, failure or cancellation
 * webhook can't leave an entity entitled for good. A paid status with no
 * `paidThroughAt` stays entitled: the provider gave no date to end it at.
 */
export function retainsPaidEntitlement(
  snapshot: Pick<
    SubscriptionSnapshot,
    "status" | "cancelAtPeriodEnd" | "paidThroughAt"
  >,
  now: Date,
  graceMs: number = DEFAULT_ENTITLEMENT_GRACE_MS,
): boolean {
  // A cancellation scheduled for the period end stops paid access once the
  // period has passed, even if the provider's final event has not arrived.
  if (
    snapshot.cancelAtPeriodEnd &&
    snapshot.paidThroughAt &&
    snapshot.paidThroughAt.getTime() <= now.getTime()
  ) {
    return false;
  }
  if (PAID_STATUSES.has(snapshot.status)) {
    return (
      !snapshot.paidThroughAt ||
      snapshot.paidThroughAt.getTime() + graceMs > now.getTime()
    );
  }
  return (
    snapshot.status === "cancelled" &&
    snapshot.cancelAtPeriodEnd &&
    Boolean(snapshot.paidThroughAt && snapshot.paidThroughAt.getTime() > now.getTime())
  );
}
