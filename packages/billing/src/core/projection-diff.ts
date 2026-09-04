import type { CanonicalSubscriptionStatus } from "./ids.js";

export type MaterialSnapshotFields = {
    status: CanonicalSubscriptionStatus;
    providerProductId: string;
    priceEntryId: string;
    catalogRevision: number;
    offerKey: string;
    plan: string;
    interval: string;
    currentPeriodStartsAt: Date | null;
    currentPeriodEndsAt: Date | null;
    paidThroughAt: Date | null;
    trialEndsAt: Date | null;
    cancelAtPeriodEnd: boolean;
    activeSubscriptionId: string | null;
};

export type FreshnessFields = {
    lastObservedAt: Date | null;
    lastReconciledAt: Date | null;
};

export type ProjectionDiff =
    | { kind: "equivalent"; freshness: FreshnessFields }
    | {
          kind: "material";
          next: MaterialSnapshotFields;
          freshness: FreshnessFields;
      };

function timeEq(
    a: Date | null | undefined,
    b: Date | null | undefined,
): boolean {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return a.getTime() === b.getTime();
}

export function materialFieldsEqual(
    previous: MaterialSnapshotFields,
    next: MaterialSnapshotFields,
): boolean {
    return (
        previous.status === next.status &&
        previous.providerProductId === next.providerProductId &&
        previous.priceEntryId === next.priceEntryId &&
        previous.catalogRevision === next.catalogRevision &&
        previous.offerKey === next.offerKey &&
        previous.plan === next.plan &&
        previous.interval === next.interval &&
        timeEq(previous.currentPeriodStartsAt, next.currentPeriodStartsAt) &&
        timeEq(previous.currentPeriodEndsAt, next.currentPeriodEndsAt) &&
        timeEq(previous.paidThroughAt, next.paidThroughAt) &&
        timeEq(previous.trialEndsAt, next.trialEndsAt) &&
        previous.cancelAtPeriodEnd === next.cancelAtPeriodEnd &&
        previous.activeSubscriptionId === next.activeSubscriptionId
    );
}

export function diffProjection(
    previous: MaterialSnapshotFields | null,
    next: MaterialSnapshotFields,
    freshness: FreshnessFields,
): ProjectionDiff {
    if (previous && materialFieldsEqual(previous, next)) {
        return { kind: "equivalent", freshness };
    }
    return { kind: "material", next, freshness };
}

export function nextProjectionVersion(
    current: number,
    diff: ProjectionDiff,
): number {
    return diff.kind === "material" ? current + 1 : current;
}
