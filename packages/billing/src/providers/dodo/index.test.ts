import { describe, expect, it } from "vitest";
import { frozenClock } from "../../core/clock.js";
import {
    mapDodoHttpError,
    mapDodoStatus,
    normalizeDodoSubscription,
} from "./normalize.js";

const clock = frozenClock(new Date("2026-06-01T00:00:00.000Z"));

describe("dodo status mapping", () => {
    it("maps provider names onto canonical statuses", () => {
        expect(mapDodoStatus("active", "subscription.updated")).toBe("active");
        expect(mapDodoStatus("on_hold", "subscription.updated")).toBe(
            "past_due",
        );
        expect(mapDodoStatus("paused", "subscription.updated")).toBe(
            "past_due",
        );
        expect(mapDodoStatus("cancelled", "subscription.updated")).toBe(
            "cancelled",
        );
        expect(mapDodoStatus("expired", "subscription.updated")).toBe(
            "expired",
        );
        expect(mapDodoStatus("pending", "subscription.updated")).toBe(
            "pending",
        );
        expect(mapDodoStatus("weird", "subscription.on_hold")).toBe("past_due");
    });

    it("promotes active+open trial to trialing", () => {
        const snapshot = normalizeDodoSubscription(
            {
                status: "active",
                trial_ends_at: "2026-07-01T00:00:00.000Z",
                customer_id: "cus_1",
                subscription_id: "sub_1",
                product_id: "pdt_1",
                metadata: {
                    checkoutAttemptId: "bca_1",
                    catalogKey: "pro_month",
                },
            },
            "subscription.updated",
            clock.now(),
            new Date("2026-05-01T00:00:00.000Z"),
        );
        expect(snapshot.status).toBe("trialing");
        expect(snapshot.metadata.checkoutAttemptId).toBe("bca_1");
        expect(JSON.stringify(snapshot)).not.toMatch(/sendlit/);
        expect(snapshot.providerOccurredAt?.toISOString()).toBe(
            "2026-05-01T00:00:00.000Z",
        );
        expect(snapshot.observedAt.toISOString()).toBe(
            "2026-06-01T00:00:00.000Z",
        );
    });

    it("maps HTTP statuses to stable provider error codes", () => {
        expect(mapDodoHttpError(401)).toBe("unauthorized");
        expect(mapDodoHttpError(409)).toBe("conflict");
        expect(mapDodoHttpError(429)).toBe("rate_limited");
        expect(mapDodoHttpError(400)).toBe("invalid");
        expect(mapDodoHttpError(500)).toBe("unavailable");
        expect(mapDodoHttpError(0)).toBe("unavailable");
    });
});
