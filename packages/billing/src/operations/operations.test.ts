import { describe, expect, it } from "bun:test";
import { MemorySensitiveValuePort } from "../ports/sensitive-values.js";
import { entity, grant, payer } from "../testing/fixtures.js";
import { createWorkflowHarness } from "../testing/workflow-harness.js";
import { createOperations } from "./index.js";

describe("operations", () => {
  it("requires operator context and separately audits decrypt", async () => {
    const { billing, authorization, now, clock } = createWorkflowHarness();
    const workspace = entity("ws_1");
    const actor = payer();
    const token = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(token);
    await billing.startCheckout({
      grant: token,
      entity: workspace,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
    });
    const sensitive = new MemorySensitiveValuePort();
    const ops = createOperations({
      billing,
      clock,
      requestedRevision: 1,
      sensitiveValues: sensitive,
    });
    await expect(
      ops.requestCancellation({ actorId: "", reason: "" }, "missing"),
    ).rejects.toThrow();
    const decrypted = await ops.decryptReplay(
      { actorId: "ops_1", reason: "support ticket" },
      "enc:https://secret",
    );
    expect(decrypted).toBe("https://secret");
    expect(sensitive.decrypts).toHaveLength(1);
    expect((await ops.health()).stuckCreatingCheckouts).toBe(0);
  });

  it("inspects and retries a webhook through operations", async () => {
    const { billing, fake, authorization, now, clock, store } = createWorkflowHarness();
    const workspace = entity("ws_ops_wh");
    const actor = payer("acct_ops_wh");
    const token = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(token);
    const checkout = await billing.startCheckout({
      grant: token,
      entity: workspace,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
    });
    const paid = await fake.simulatePayment(
      checkout.attempt.providerCheckoutSessionId!,
    );
    const signed = fake.signWebhook(
      JSON.stringify({
        type: "subscription.updated",
        data: {
          subscription_id: paid.providerSubscriptionId,
          metadata: { checkoutAttemptId: checkout.attempt.attemptId },
        },
      }),
    );
    await billing.ingestWebhook({ provider: "fake", raw: signed });
    store.webhooks[0]!.status = "quarantined";
    store.webhooks[0]!.lastError = "operation_quarantined";
    const ops = createOperations({
      billing,
      clock,
      requestedRevision: 1,
    });
    const view = await ops.inspectWebhook(signed.headers["webhook-id"]!);
    expect(view.status).toBe("quarantined");
    expect(view.eventType).toBe("subscription.updated");
    expect(view.hasPayload).toBe(false);
    await ops.retryWebhook(
      { actorId: "ops_1", reason: "retry inbox" },
      signed.headers["webhook-id"]!,
      "new_budget",
    );
    expect(store.webhooks[0]!.status as string).toBe("processed");
    expect(store.subscriptions).toHaveLength(1);
  });

  it("projects a provider subscription when local entitlement is missing", async () => {
    const { billing, fake, authorization, now, clock, store } = createWorkflowHarness();
    const workspace = entity("ws_ops_project");
    const actor = payer("acct_ops_project");
    const token = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(token);
    const checkout = await billing.startCheckout({
      grant: token,
      entity: workspace,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
    });
    const paid = await fake.simulatePayment(
      checkout.attempt.providerCheckoutSessionId!,
    );
    expect(store.subscriptions).toHaveLength(0);
    const ops = createOperations({
      billing,
      clock,
      requestedRevision: 1,
      checkoutProvider: "fake",
    });
    await expect(
      ops.reconcileEntity({ actorId: "ops_1", reason: "catch up" }, workspace.id),
    ).rejects.toMatchObject({ code: "subscription_required" });
    const write = await ops.projectProviderSubscription(
      { actorId: "ops_1", reason: "catch up paid checkout" },
      {
        providerSubscriptionId: paid.providerSubscriptionId,
        checkoutAttemptId: checkout.attempt.attemptId,
      },
    );
    expect(write.subscription.offerKey).toBe("pro_month");
    expect(write.subscription.billableEntityId).toBe(workspace.id);
    expect(store.checkouts[0]!.status).toBe("completed");
    expect((await billing.commercialState(workspace.id)).activePaidPlan).toBe("pro");
  });
});
