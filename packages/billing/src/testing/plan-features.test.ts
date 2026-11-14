import { describe, expect, it } from "bun:test";
import { frozenClock } from "../core/clock.js";
import { MemoryBillingStore } from "../persistence/memory.js";
import { MemoryAuthorizationPort } from "../ports/authorization.js";
import { createBilling } from "../workflows/engine.js";
import { entity, grant, payer, REFERENCE_OFFERS } from "./fixtures.js";
import { createWorkflowHarness } from "./workflow-harness.js";

const planFeatures = { business: ["learner_sso"], pro: ["custom_domain"] };

async function subscribe(
  harness: ReturnType<typeof createWorkflowHarness>,
  offerKey: string,
  entityId: string,
) {
  const { billing, fake, authorization, now } = harness;
  const workspace = entity(entityId);
  const actor = payer();
  const token = grant("checkout", workspace.id, actor.id, now);
  authorization.issue(token);
  const checkout = await billing.startCheckout({
    grant: token,
    entity: workspace,
    payer: actor,
    offerKey,
    catalogRevision: 1,
    returnUrl: "https://app.test/billing",
  });
  const snapshot = await fake.simulatePayment(
    checkout.attempt.providerCheckoutSessionId!,
  );
  await billing.projectSnapshot(snapshot, {
    checkoutAttemptId: checkout.attempt.attemptId,
  });
  return workspace;
}

describe("hasFeature", () => {
  it("is true only for features of the entitled paid plan", async () => {
    const harness = createWorkflowHarness(undefined, { planFeatures });
    const business = await subscribe(harness, "business_month", "ws_business");
    const pro = await subscribe(harness, "pro_month", "ws_pro");
    const { billing } = harness;
    expect(await billing.hasFeature(business.id, "learner_sso")).toBe(true);
    expect(await billing.hasFeature(business.id, "custom_domain")).toBe(false);
    expect(await billing.hasFeature(pro.id, "learner_sso")).toBe(false);
    expect(await billing.hasFeature(pro.id, "custom_domain")).toBe(true);
  });

  it("is false for unknown features, free entities and prototype keys", async () => {
    const harness = createWorkflowHarness(undefined, { planFeatures });
    const business = await subscribe(harness, "business_month", "ws_business");
    const { billing } = harness;
    expect(await billing.hasFeature(business.id, "nope")).toBe(false);
    expect(await billing.hasFeature(business.id, "constructor")).toBe(false);
    expect(await billing.hasFeature("ws_free", "learner_sso")).toBe(false);
  });

  it("is false when no planFeatures are declared", async () => {
    const harness = createWorkflowHarness();
    const business = await subscribe(harness, "business_month", "ws_business");
    expect(await harness.billing.hasFeature(business.id, "learner_sso")).toBe(false);
  });

  it("follows the same entitlement semantics as activePaidPlan", async () => {
    const harness = createWorkflowHarness(undefined, { planFeatures });
    const business = await subscribe(harness, "business_month", "ws_business");
    const { billing, store } = harness;
    const subscription = store.subscriptions[0]!;
    // Cancelled at period end and the period has passed: no entitlement.
    subscription.cancelAtPeriodEnd = true;
    subscription.paidThroughAt = new Date(harness.now.getTime() - 1);
    expect((await billing.commercialState(business.id)).activePaidPlan).toBeNull();
    expect(await billing.hasFeature(business.id, "learner_sso")).toBe(false);
    // Cancelled at period end but still inside the paid period: entitled.
    subscription.paidThroughAt = new Date(harness.now.getTime() + 86_400_000);
    expect((await billing.commercialState(business.id)).activePaidPlan).toBe(
      "business",
    );
    expect(await billing.hasFeature(business.id, "learner_sso")).toBe(true);
  });

  it("fails closed when state cannot be read", async () => {
    const harness = createWorkflowHarness(undefined, { planFeatures });
    const business = await subscribe(harness, "business_month", "ws_business");
    harness.store.findPlanState = () => {
      throw new Error("db down");
    };
    expect(await harness.billing.hasFeature(business.id, "learner_sso")).toBe(false);
  });

  it("is true for every feature in oss mode, even when reads fail", async () => {
    const store = new MemoryBillingStore();
    store.findPlanState = () => {
      throw new Error("db down");
    };
    const billing = createBilling({
      database: store,
      providers: [],
      clock: frozenClock(new Date("2026-01-01T00:00:00.000Z")),
      authorization: new MemoryAuthorizationPort(),
      mode: "oss",
      checkoutProvider: "",
      requestedRevision: null,
      requiredOfferKeys: [],
    });
    expect(await billing.hasFeature("any_entity", "learner_sso")).toBe(true);
    expect(await billing.hasFeature("any_entity", "anything_else")).toBe(true);
  });

  it("rejects planFeatures naming a plan that has no offer", () => {
    expect(() =>
      createWorkflowHarness(undefined, { planFeatures: { gold: ["x"] } }),
    ).toThrow(/plan_features_invalid/);
    expect(REFERENCE_OFFERS.some((offer) => offer.plan === "gold")).toBe(false);
  });
});

const planLimits = {
  pro: { marketing_emails_month: 10_000, storage_bytes: 20 },
  business: { marketing_emails_month: 50_000, storage_bytes: null },
};

describe("getLimit and limits", () => {
  it("answer the entitled plan's allowance, with null as unlimited", async () => {
    const harness = createWorkflowHarness(undefined, { planLimits });
    const business = await subscribe(harness, "business_month", "ws_business");
    const pro = await subscribe(harness, "pro_month", "ws_pro");
    const { billing } = harness;
    expect(await billing.getLimit(pro.id, "marketing_emails_month")).toBe(10_000);
    expect(await billing.getLimit(pro.id, "storage_bytes")).toBe(20);
    expect(await billing.getLimit(business.id, "storage_bytes")).toBeNull();
    expect(await billing.limits(business.id)).toEqual({
      marketing_emails_month: 50_000,
      storage_bytes: null,
    });
  });

  it("answer 0 for an entity with no entitled plan", async () => {
    const harness = createWorkflowHarness(undefined, { planLimits });
    expect(await harness.billing.getLimit("ws_free", "storage_bytes")).toBe(0);
    expect(await harness.billing.limits("ws_free")).toEqual({
      marketing_emails_month: 0,
      storage_bytes: 0,
    });
  });

  it("answer 0 once paid access has lapsed", async () => {
    const harness = createWorkflowHarness(undefined, { planLimits });
    const pro = await subscribe(harness, "pro_month", "ws_pro");
    const subscription = harness.store.subscriptions[0]!;
    subscription.cancelAtPeriodEnd = true;
    subscription.paidThroughAt = new Date(harness.now.getTime() - 1);
    expect(await harness.billing.getLimit(pro.id, "storage_bytes")).toBe(0);
  });

  it("throw on an undeclared key, so a typo never reads as unlimited", async () => {
    const harness = createWorkflowHarness(undefined, { planLimits });
    const pro = await subscribe(harness, "pro_month", "ws_pro");
    await expect(harness.billing.getLimit(pro.id, "storage_byte")).rejects.toThrow(
      /limit_key_unknown/,
    );
    await expect(harness.billing.getLimit(pro.id, "constructor")).rejects.toThrow(
      /limit_key_unknown/,
    );
  });

  it("throw when billing can't be read, instead of answering a number", async () => {
    const harness = createWorkflowHarness(undefined, { planLimits });
    const pro = await subscribe(harness, "pro_month", "ws_pro");
    harness.store.findPlanState = () => {
      throw new Error("db down");
    };
    await expect(harness.billing.getLimit(pro.id, "storage_bytes")).rejects.toThrow("db down");
    await expect(harness.billing.limits(pro.id)).rejects.toThrow("db down");
  });

  it("are unlimited in oss mode, even when reads fail", async () => {
    const store = new MemoryBillingStore();
    store.findPlanState = () => {
      throw new Error("db down");
    };
    const billing = createBilling({
      database: store,
      providers: [],
      clock: frozenClock(new Date("2026-01-01T00:00:00.000Z")),
      authorization: new MemoryAuthorizationPort(),
      mode: "oss",
      checkoutProvider: "",
      requestedRevision: null,
      requiredOfferKeys: [],
      planLimits,
    });
    expect(await billing.getLimit("any_entity", "storage_bytes")).toBeNull();
    expect(await billing.limits("any_entity")).toEqual({
      marketing_emails_month: null,
      storage_bytes: null,
    });
  });

  it("reject plans that declare different keys", () => {
    expect(() =>
      createWorkflowHarness(undefined, {
        planLimits: { pro: { storage_bytes: 1 }, business: { storage_bytes: 2, seats: 3 } },
      }),
    ).toThrow(/plan_limits_keys_differ/);
  });

  it("reject a cloud catalog plan that has no limits, or limits for a plan with no offer", () => {
    expect(() =>
      createWorkflowHarness(undefined, { planLimits: { pro: { storage_bytes: 1 } } }),
    ).toThrow(/plan_limits_plans_mismatch/);
    expect(() =>
      createWorkflowHarness(undefined, {
        planLimits: { ...planLimits, gold: { marketing_emails_month: 1, storage_bytes: 1 } },
      }),
    ).toThrow(/plan_limits_plans_mismatch/);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("reject the value %p", (value) => {
    expect(() =>
      createWorkflowHarness(undefined, {
        planLimits: { pro: { storage_bytes: value }, business: { storage_bytes: 1 } },
      }),
    ).toThrow(/plan_limits_invalid/);
  });
});

describe("entitlementGraceMs", () => {
  it("ends paid access that long after paidThroughAt", async () => {
    const harness = createWorkflowHarness(undefined, { planFeatures, entitlementGraceMs: 0 });
    const business = await subscribe(harness, "business_month", "ws_business");
    const subscription = harness.store.subscriptions[0]!;
    subscription.paidThroughAt = new Date(harness.now.getTime() - 1);
    expect(await harness.billing.hasFeature(business.id, "learner_sso")).toBe(false);
  });

  it("rejects a negative or fractional grace", () => {
    for (const entitlementGraceMs of [-1, 0.5]) {
      expect(() => createWorkflowHarness(undefined, { entitlementGraceMs })).toThrow(
        /entitlement_grace_invalid/,
      );
    }
  });
});
