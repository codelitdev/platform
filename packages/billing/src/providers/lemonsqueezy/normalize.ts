import type { CanonicalSubscriptionStatus } from "../../core/ids.js";
import type { SubscriptionSnapshot } from "../../core/subscription.js";

export function dateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Lemon Squeezy statuses: `on_trial`, `active`, `paused`, `past_due`,
 * `unpaid`, `cancelled` (paid until `ends_at`), and `expired`.
 */
export function mapLemonSqueezyStatus(status: string): CanonicalSubscriptionStatus {
  switch (status) {
    case "on_trial":
      return "trialing";
    case "active":
      return "active";
    case "paused":
    case "past_due":
      return "past_due";
    case "unpaid":
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      return "pending";
  }
}

/** Normalises a Lemon Squeezy subscription resource (`data.attributes`). */
export function normalizeLemonSqueezySubscription(
  id: string,
  attributes: Record<string, unknown>,
  observedAt: Date,
): SubscriptionSnapshot {
  const status = String(attributes.status ?? "");
  // `cancelled` keeps paid access until `ends_at`; `unpaid` has none left.
  const scheduledEnd = status === "cancelled";
  const renewsAt = dateOrNull(attributes.renews_at);
  const endsAt = dateOrNull(attributes.ends_at);
  const trialEndsAt = dateOrNull(attributes.trial_ends_at);
  const paidThroughAt =
    status === "unpaid"
      ? null
      : scheduledEnd
        ? endsAt
        : status === "on_trial"
          ? (trialEndsAt ?? renewsAt)
          : renewsAt;
  return {
    provider: "lemonsqueezy",
    providerCustomerId: String(attributes.customer_id ?? ""),
    providerSubscriptionId: String(id),
    providerProductId: String(attributes.variant_id ?? ""),
    status: mapLemonSqueezyStatus(status),
    currentPeriodStartsAt: null,
    currentPeriodEndsAt: scheduledEnd ? endsAt : renewsAt,
    paidThroughAt,
    trialEndsAt,
    cancelAtPeriodEnd: scheduledEnd,
    providerOccurredAt: dateOrNull(attributes.updated_at ?? attributes.created_at),
    providerVersion:
      typeof attributes.updated_at === "string" ? attributes.updated_at : null,
    observedAt,
    metadata: {},
  };
}

export function mapLemonSqueezyHttpError(
  status: number,
): "invalid" | "unauthorized" | "conflict" | "rate_limited" | "unavailable" {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 400 && status < 500) return "invalid";
  return "unavailable";
}
