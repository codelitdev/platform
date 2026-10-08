import { describe, expect, it } from "bun:test";
import { FakeBillingProvider } from "../providers/fake/index.js";
import { createBilling } from "../workflows/engine.js";
import { entity, grant, payer, REFERENCE_OFFERS } from "./fixtures.js";
import { createWorkflowHarness } from "./workflow-harness.js";

describe("provider coexistence", () => {
  it("serves subscriptions on the old provider after checkout moves to a new one", async () => {
    const { billing, fake, store, authorization, audit, clock, now } =
      createWorkflowHarness();
    const workspace = entity("ws_old_provider");
    const actor = payer("acct_old_provider");
    let grants = 0;
    const issue = (
      action: Parameters<typeof grant>[0],
      entityId = workspace.id,
      payerId = actor.id,
    ) => {
      const token = {
        ...grant(action, entityId, payerId, now),
        grantId: `grant_coexist_${++grants}`,
      };
      authorization.issue(token);
      return token;
    };
    const checkout = await billing.startCheckout({
      grant: issue("checkout"),
      entity: workspace,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
    });
    const paid = await fake.simulatePayment(
      checkout.attempt.providerCheckoutSessionId!,
    );
    await billing.projectSnapshot(paid, {
      checkoutAttemptId: checkout.attempt.attemptId,
    });

    // Both providers composed; new checkout goes to the second one.
    const next = new FakeBillingProvider({ clock, provider: "fake_next" });
    next.seedDefaultCatalog();
    const switched = createBilling({
      database: store,
      providers: [fake, next],
      clock,
      authorization,
      hooks: { audit },
      mode: "cloud",
      checkoutProvider: "fake_next",
      requestedRevision: 2,
      requiredOfferKeys: REFERENCE_OFFERS.map((offer) => offer.key),
      offers: REFERENCE_OFFERS.map((offer) => ({
        ...offer,
        revision: 2,
        provider: "fake_next",
      })),
      returnUrlValidator: (url) => url.startsWith("https://app.test/"),
    });
    await expect(switched.verifyRequestedCatalog()).resolves.toEqual({
      verified: true,
      revision: 2,
      mismatches: [],
    });
    const catalog = await switched.publicCatalog();
    expect(catalog?.revision).toBe(2);
    expect(catalog?.checkoutAvailable).toBe(true);

    const before = await switched.commercialState(workspace.id);
    expect(before.activePaidPlan).toBe("pro");
    expect(before.provider).toBe("fake");

    // A cancel made at the old provider arrives by webhook.
    await fake.cancelSubscription(paid.providerSubscriptionId, "cancel_at_provider");
    await switched.ingestWebhook({
      provider: "fake",
      raw: fake.signWebhook(
        JSON.stringify({
          type: "subscription.updated",
          data: { subscription_id: paid.providerSubscriptionId },
        }),
      ),
    });
    await switched.runWebhookInboxBatch({ workerId: "coexist" });
    expect(store.webhooks.at(-1)?.status).toBe("processed");
    expect((await switched.commercialState(workspace.id)).cancelAtPeriodEnd).toBe(true);

    // Resume, cancel, and the portal go to the subscription's own provider.
    await switched.resumeCancellation({
      grant: issue("cancellation"),
      entity: workspace,
      payer: actor,
    });
    expect(
      (await fake.retrieveSubscription(paid.providerSubscriptionId)).cancelAtPeriodEnd,
    ).toBe(false);
    await switched.cancel({
      grant: issue("cancellation"),
      entity: workspace,
      payer: actor,
    });
    expect(
      (await fake.retrieveSubscription(paid.providerSubscriptionId)).cancelAtPeriodEnd,
    ).toBe(true);
    const portal = await switched.startPortal({
      grant: issue("portal"),
      entity: workspace,
      payer: actor,
      returnUrl: "https://app.test/billing",
    });
    expect(portal.portalUrl).toBeTruthy();
    const after = await switched.commercialState(workspace.id);
    expect(after.activePaidPlan).toBe("pro");
    expect(after.provider).toBe("fake");

    // A new subscriber checks out with the new provider.
    const newcomer = entity("ws_new_provider");
    const newcomerPayer = payer("acct_new_provider");
    const fresh = await switched.startCheckout({
      grant: issue("checkout", newcomer.id, newcomerPayer.id),
      entity: newcomer,
      payer: newcomerPayer,
      offerKey: "pro_month",
      catalogRevision: 2,
      returnUrl: "https://app.test/billing",
    });
    expect(fresh.attempt.provider).toBe("fake_next");
    expect(next.createCheckoutCalls).toHaveLength(1);
    expect(fake.createCheckoutCalls).toHaveLength(1);

    await expect(
      switched.runReconciliationBatch({ workerId: "coexist" }),
    ).resolves.toBeDefined();
  });
});
