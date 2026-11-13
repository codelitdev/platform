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
