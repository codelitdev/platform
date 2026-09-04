export const DEFAULT_WEBHOOK_MAX_ATTEMPTS = 8;

const INITIAL_RETRY_DELAYS_MS = [
    60 * 1000,
    5 * 60 * 1000,
    30 * 60 * 1000,
    2 * 60 * 60 * 1000,
] as const;

const TAIL_RETRY_DELAY_MS = 8 * 60 * 60 * 1000;

export type BillingWebhookRetry =
    { status: "quarantined" } | { status: "failed"; delayMs: number };

export function billingWebhookRetry(
    processingAttempts: number,
    jitterMs = 0,
): BillingWebhookRetry {
    if (processingAttempts >= DEFAULT_WEBHOOK_MAX_ATTEMPTS) {
        return { status: "quarantined" };
    }
    const index = Math.max(0, processingAttempts - 1);
    if (index < INITIAL_RETRY_DELAYS_MS.length) {
        return { status: "failed", delayMs: INITIAL_RETRY_DELAYS_MS[index] };
    }
    return { status: "failed", delayMs: TAIL_RETRY_DELAY_MS + jitterMs };
}
