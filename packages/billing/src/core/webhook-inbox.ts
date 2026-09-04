export const WEBHOOK_INBOX_STATUSES = [
    "pending",
    "processing",
    "failed",
    "processed",
    "ignored",
    "quarantined",
] as const;

export type WebhookInboxStatus = (typeof WEBHOOK_INBOX_STATUSES)[number];

export type WebhookInboxRecord = {
    id: string;
    provider: string;
    providerEventId: string;
    eventType: string;
    occurredAt: Date;
    subscriptionId: string | null;
    checkoutAttemptId: string | null;
    payloadEncrypted?: string | null;
    payloadKeyVersion?: string | null;
    verifiedKeyVersion: string | null;
    status: WebhookInboxStatus;
    processingAttempts: number;
    lastError: string | null;
    availableAt: Date;
    lockedAt: Date | null;
    leaseExpiresAt: Date | null;
    workerId: string | null;
    processedAt?: Date | null;
};
