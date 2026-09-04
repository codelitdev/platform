import { describe, expect, it } from "vitest";
import { frozenClock } from "./clock.js";
import {
    decideCheckoutTransition,
    decideCustomerTransition,
    decidePlanChangeTransition,
    decideReconciliationTransition,
    decideSubscriptionTransition,
    decideWebhookInboxTransition,
} from "./transitions.js";

const t0 = new Date("2026-01-01T00:00:00.000Z");
const clock = frozenClock(t0);

describe("subscription transitions", () => {
    const cases: Array<[string, string, boolean]> = [
        ["pending", "trialing", true],
        ["pending", "active", true],
        ["pending", "past_due", false],
        ["trialing", "active", true],
        ["active", "past_due", true],
        ["active", "pending", false],
        ["past_due", "active", true],
        ["cancelled", "active", true],
        ["cancelled", "trialing", true],
        ["cancelled", "past_due", true],
        ["cancelled", "expired", true],
        ["expired", "active", false],
        ["expired", "expired", true],
    ];
    it.each(cases)("%s -> %s allowed=%s", (from, to, allowed) => {
        const decision = decideSubscriptionTransition(
            from as never,
            to as never,
        );
        expect(decision.allowed).toBe(allowed);
    });
});

describe("checkout transitions", () => {
    const expiresAt = new Date(t0.getTime() + 60_000);
    const ctx = {
        now: clock.now(),
        expiresAt,
        entityUnchanged: true,
        payerUnchanged: true,
    };

    it("creating may open/expire/abandon/conflict", () => {
        for (const next of [
            "open",
            "expired",
            "abandoned",
            "conflicted",
        ] as const) {
            expect(
                decideCheckoutTransition("creating", next, ctx).allowed,
            ).toBe(true);
        }
        expect(
            decideCheckoutTransition("creating", "completed", ctx).allowed,
        ).toBe(false);
    });

    it("open may complete", () => {
        expect(decideCheckoutTransition("open", "completed", ctx).allowed).toBe(
            true,
        );
    });

    it("expired completes only with verified pre-expiry subscription", () => {
        const pre = {
            ...ctx,
            subscriptionObservedAt: new Date(expiresAt.getTime() - 1),
        };
        expect(
            decideCheckoutTransition("expired", "completed", pre).allowed,
        ).toBe(true);
        const post = {
            ...ctx,
            subscriptionObservedAt: new Date(expiresAt.getTime() + 1),
        };
        expect(
            decideCheckoutTransition("expired", "completed", post).allowed,
        ).toBe(false);
        const mismatch = {
            ...pre,
            payerUnchanged: false,
        };
        expect(
            decideCheckoutTransition("expired", "completed", mismatch).allowed,
        ).toBe(false);
    });

    it("abandoned late subscription is conflicted, not completed", () => {
        expect(
            decideCheckoutTransition("abandoned", "completed", ctx).allowed,
        ).toBe(false);
        expect(
            decideCheckoutTransition("abandoned", "conflicted", ctx).allowed,
        ).toBe(true);
    });

    it("completed and conflicted need operator repair", () => {
        expect(decideCheckoutTransition("completed", "open", ctx).allowed).toBe(
            false,
        );
        expect(
            decideCheckoutTransition("completed", "open", {
                ...ctx,
                operatorRepair: true,
            }).allowed,
        ).toBe(true);
    });
});

describe("plan-change / webhook / customer / reconciliation machines", () => {
    it("plan-change creating and pending", () => {
        expect(decidePlanChangeTransition("creating", "pending").allowed).toBe(
            true,
        );
        expect(decidePlanChangeTransition("pending", "succeeded").allowed).toBe(
            true,
        );
        expect(decidePlanChangeTransition("succeeded", "pending").allowed).toBe(
            false,
        );
    });

    it("webhook inbox leases", () => {
        expect(
            decideWebhookInboxTransition("pending", "processing").allowed,
        ).toBe(true);
        expect(
            decideWebhookInboxTransition("processing", "processed").allowed,
        ).toBe(true);
        expect(
            decideWebhookInboxTransition("processed", "pending").allowed,
        ).toBe(false);
    });

    it("provider customer", () => {
        expect(decideCustomerTransition("creating", "active").allowed).toBe(
            true,
        );
        expect(decideCustomerTransition("active", "creating").allowed).toBe(
            false,
        );
        expect(decideCustomerTransition("creating", "conflicted").allowed).toBe(
            true,
        );
    });

    it("reconciliation job reclaim", () => {
        expect(
            decideReconciliationTransition("pending", "processing").allowed,
        ).toBe(true);
        expect(
            decideReconciliationTransition("processing", "failed").allowed,
        ).toBe(true);
        expect(
            decideReconciliationTransition("failed", "processing").allowed,
        ).toBe(true);
        expect(
            decideReconciliationTransition("completed", "pending").allowed,
        ).toBe(true);
    });
});
