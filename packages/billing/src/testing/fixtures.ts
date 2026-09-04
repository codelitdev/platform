import type { BillingOffer } from "../catalog/types.js";
import type { BillingActionGrant } from "../ports/authorization.js";
import type { BillableEntityRef, PayerRef } from "../core/ids.js";

export const REFERENCE_OFFERS: BillingOffer[] = [
    {
        key: "pro_month",
        revision: 1,
        plan: "pro",
        interval: "month",
        currency: "USD",
        amountMinor: 4900,
        provider: "fake",
        providerProductId: "pdt_pro_month",
        providerTrialDays: 14,
    },
    {
        key: "pro_year",
        revision: 1,
        plan: "pro",
        interval: "year",
        currency: "USD",
        amountMinor: 49000,
        provider: "fake",
        providerProductId: "pdt_pro_year",
        providerTrialDays: 0,
    },
    {
        key: "business_month",
        revision: 1,
        plan: "business",
        interval: "month",
        currency: "USD",
        amountMinor: 19900,
        provider: "fake",
        providerProductId: "pdt_business_month",
        providerTrialDays: 0,
    },
    {
        key: "business_year",
        revision: 1,
        plan: "business",
        interval: "year",
        currency: "USD",
        amountMinor: 199000,
        provider: "fake",
        providerProductId: "pdt_business_year",
        providerTrialDays: 0,
    },
];

export const COURSELIT_OFFER_KEYS = [
    "pro_month",
    "pro_year",
    "business_month",
    "business_year",
] as const;

export function payer(id = "acct_payer"): PayerRef {
    return { id, email: "payer@example.com", name: "Payer" };
}

export function entity(id: string, kind = "workspace"): BillableEntityRef {
    return { kind, id };
}

export function grant(
    action: BillingActionGrant["action"],
    targetId: string,
    actorId = "acct_payer",
    now = new Date("2026-01-01T00:00:00.000Z"),
): BillingActionGrant {
    return {
        grantId: `grant_${action}_${targetId}_${now.getTime()}`,
        actorId,
        action,
        target: { kind: "workspace", id: targetId },
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    };
}
