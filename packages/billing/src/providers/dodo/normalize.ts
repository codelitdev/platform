import type { CanonicalSubscriptionStatus } from "../../core/ids.js";
import type { SubscriptionSnapshot } from "../../core/subscription.js";

export function dateOrNull(value: unknown): Date | null {
    if (typeof value !== "string" || !value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function metadataValue(metadata: unknown, key: string): string | undefined {
    if (!metadata || typeof metadata !== "object") return undefined;
    const value = (metadata as Record<string, unknown>)[key];
    return typeof value === "string" &&
        value.length > 0 &&
        value.length <= 128 &&
        !/\s/.test(value)
        ? value
        : undefined;
}

export function mapDodoStatus(
    sourceStatus: string,
    eventType: string,
): CanonicalSubscriptionStatus {
    const status = sourceStatus.toLowerCase();
    if (status === "active") return "active";
    if (status === "on_hold" || status === "paused") return "past_due";
    if (status === "cancelled") return "cancelled";
    if (status === "expired" || status === "failed") return "expired";
    if (status === "pending") return "pending";
    if (eventType === "subscription.on_hold") return "past_due";
    return "pending";
}

export function normalizeDodoSubscription(
    data: Record<string, unknown>,
    eventType: string,
    observedAt: Date,
    providerOccurredAt: Date | null,
): SubscriptionSnapshot {
    const status = mapDodoStatus(String(data?.status ?? "pending"), eventType);
    const trialEndsAt = dateOrNull(data?.trial_end ?? data?.trial_ends_at);
    const canonicalStatus: CanonicalSubscriptionStatus =
        status === "active" && trialEndsAt && trialEndsAt > observedAt
            ? "trialing"
            : status;
    const metadata = data?.metadata;
    return {
        provider: "dodo",
        providerCustomerId: String(
            (data?.customer as { customer_id?: string } | undefined)
                ?.customer_id ??
                data?.customer_id ??
                "",
        ),
        providerSubscriptionId: String(data?.subscription_id ?? data?.id ?? ""),
        providerProductId: String(data?.product_id ?? ""),
        status: canonicalStatus,
        currentPeriodStartsAt: dateOrNull(
            data?.previous_billing_date ?? data?.current_period_start,
        ),
        currentPeriodEndsAt: dateOrNull(
            data?.next_billing_date ?? data?.current_period_end,
        ),
        paidThroughAt: dateOrNull(
            data?.next_billing_date ??
                data?.current_period_end ??
                data?.expires_at,
        ),
        trialEndsAt,
        cancelAtPeriodEnd: Boolean(data?.cancel_at_next_billing_date),
        providerOccurredAt,
        providerVersion:
            typeof data?.updated_at === "string" ? data.updated_at : null,
        observedAt,
        metadata: {
            checkoutAttemptId: metadataValue(metadata, "checkoutAttemptId"),
            catalogKey: metadataValue(metadata, "catalogKey"),
        },
    };
}

export function mapDodoHttpError(
    status: number,
): "invalid" | "unauthorized" | "conflict" | "rate_limited" | "unavailable" {
    if (status === 401 || status === 403) return "unauthorized";
    if (status === 409) return "conflict";
    if (status === 429) return "rate_limited";
    if (status >= 400 && status < 500) return "invalid";
    return "unavailable";
}
