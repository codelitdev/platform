export const RECONCILIATION_STATUSES = [
    "pending",
    "processing",
    "failed",
    "completed",
    "quarantined",
] as const;

export type ReconciliationJobStatus = (typeof RECONCILIATION_STATUSES)[number];

export type ReconciliationSubjectKind =
    | "checkout_attempt"
    | "plan_change_attempt"
    | "subscription"
    | "provider_customer";

export type ReconciliationJob = {
    id: string;
    provider: string;
    checkoutAttemptId: string | null;
    planChangeAttemptId: string | null;
    subscriptionId: string | null;
    providerCustomerId: string | null;
    operation?: "reconcile" | "cancellation";
    status: ReconciliationJobStatus;
    attemptCount: number;
    availableAt: Date;
    lockedAt: Date | null;
    leaseExpiresAt: Date | null;
    workerId: string | null;
    lastError: string | null;
};

export function reconciliationSubjectKind(
    job: Pick<
        ReconciliationJob,
        | "checkoutAttemptId"
        | "planChangeAttemptId"
        | "subscriptionId"
        | "providerCustomerId"
    >,
): ReconciliationSubjectKind {
    const set = [
        job.checkoutAttemptId,
        job.planChangeAttemptId,
        job.subscriptionId,
        job.providerCustomerId,
    ].filter(Boolean);
    if (set.length !== 1) {
        throw new Error("reconciliation_subject_invalid");
    }
    if (job.checkoutAttemptId) return "checkout_attempt";
    if (job.planChangeAttemptId) return "plan_change_attempt";
    if (job.subscriptionId) return "subscription";
    return "provider_customer";
}
