export const PLAN_CHANGE_STATUSES = [
    "creating",
    "pending",
    "succeeded",
    "failed",
    "conflicted",
] as const;

export type PlanChangeAttemptStatus = (typeof PLAN_CHANGE_STATUSES)[number];

export const PLAN_CHANGE_NONTERMINAL: ReadonlySet<PlanChangeAttemptStatus> =
    new Set(["creating", "pending"]);

export type PlanChangeAttempt = {
    id: string;
    changeId: string;
    billableEntityId: string;
    subscriptionId: string;
    actorId: string;
    payerId: string;
    provider: string;
    idempotencyKey: string;
    currentCatalogRevision: number;
    currentPriceEntryId: string;
    currentPlan: string;
    currentInterval: "month" | "year";
    targetCatalogRevision: number;
    targetPriceEntryId: string;
    targetPlan: string;
    targetInterval: "month" | "year";
    targetOfferKey: string;
    effectiveAt: "immediately" | "next_billing_date";
    prorationMode: "prorated_immediately" | "do_not_bill";
    status: PlanChangeAttemptStatus;
    lastError: string | null;
    providerPaymentId?: string | null;
    paymentUrlEncrypted?: string | null;
    completedAt?: Date | null;
};
