import { describe, expect, it } from "bun:test";
import {
  courselitShapedCatalog,
  sendlitShapedCatalog,
} from "./consumer-conformance.js";
import { entity, grant, payer, REFERENCE_OFFERS } from "./fixtures.js";
import { createBillingFrom, createWorkflowHarness } from "./workflow-harness.js";

describe("workflow harness", () => {
  it("records, verifies, and atomically activates a requested catalog", async () => {
    const offers = REFERENCE_OFFERS.map((offer) => ({
      ...offer,
      revision: 2,
    }));
    const { billing, store, audit } = createWorkflowHarness(
      new Date("2026-01-01T00:00:00.000Z"),
      { seedLocalCatalog: false, offers },
    );

    expect(await billing.publicCatalog()).toBeNull();
    const recorded = await billing.recordRequestedCatalog();
    expect(recorded?.status).toBe("pending_verification");
    expect(await billing.recordRequestedCatalog()).toMatchObject({
      id: recorded?.id,
      status: "pending_verification",
    });

    await expect(billing.verifyRequestedCatalog()).resolves.toEqual({
      verified: true,
      revision: 2,
      mismatches: [],
    });
    expect(store.revisions).toHaveLength(1);
    expect(store.revisions[0]).toMatchObject({
      revision: 2,
      status: "active",
    });
    expect(store.priceEntries).toHaveLength(4);
    expect(store.revisionItems).toHaveLength(4);
    expect((await billing.publicCatalog())?.checkoutAvailable).toBe(true);
    expect(
      audit.records.filter((record) => record.effectId === "catalog:2:activated"),
    ).toHaveLength(1);

    await billing.verifyRequestedCatalog();
    expect(store.priceEntries).toHaveLength(4);
    expect(store.revisionItems).toHaveLength(4);
  });

  it("reattaches nothing when a pending revision already has verified items", async () => {
    const offers = REFERENCE_OFFERS.map((offer) => ({
      ...offer,
      revision: 3,
    }));
    const { billing, store, fake } = createWorkflowHarness(
      new Date("2026-01-01T00:00:00.000Z"),
      { seedLocalCatalog: false, offers },
    );
    const recorded = await billing.recordRequestedCatalog();
    expect(recorded?.status).toBe("pending_verification");
    const first = await billing.verifyRequestedCatalog();
    expect(first.verified).toBe(true);
    store.revisions[0]!.status = "pending_verification";
    store.revisions[0]!.activatedAt = null;
    fake.seedDefaultCatalog();
    await expect(billing.verifyRequestedCatalog()).resolves.toEqual({
      verified: true,
      revision: 3,
      mismatches: [],
    });
    expect(store.priceEntries).toHaveLength(4);
    expect(store.revisionItems).toHaveLength(4);
    expect(store.revisions[0]!.status as string).toBe("active");
  });

  it("rejects a revision number already used by another provider", async () => {
    const { billing, store } = createWorkflowHarness();
    store.revisions[0]!.checkoutProvider = "other";
    await expect(billing.recordRequestedCatalog()).rejects.toThrow(
      "catalog_revision_used_by_another_provider",
    );
    expect(store.revisions).toHaveLength(1);
  });

  it("marks a mismatched pending revision invalid without rolling back the active catalog", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const nextOffers = REFERENCE_OFFERS.map((offer) => ({
      ...offer,
      revision: 2,
    }));
    const pending = createBillingFrom(store, fake, now, nextOffers, {
      authorization,
    });
    fake.seedProduct({
      provider: "fake",
      providerProductId: "pdt_pro_month",
      currency: "USD",
      amountMinor: 1,
      interval: "month",
    });
    await pending.recordRequestedCatalog();
    await expect(pending.verifyRequestedCatalog()).resolves.toEqual({
      verified: false,
      revision: 2,
      mismatches: ["pro_month"],
    });
    expect(store.revisions.find((row) => row.revision === 2)?.status).toBe("invalid");
    expect(store.revisions.find((row) => row.revision === 1)?.status).toBe("active");
    expect((await pending.publicCatalog())?.checkoutAvailable).toBe(false);
    expect((await billing.publicCatalog())?.checkoutAvailable).toBe(true);
    const workspace = entity("ws_catalog_mismatch");
    const actor = payer();
    const token = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(token);
    await expect(
      pending.startCheckout({
        grant: token,
        entity: workspace,
        payer: actor,
        offerKey: "pro_month",
        catalogRevision: 1,
        returnUrl: "https://app.test/billing",
      }),
    ).rejects.toMatchObject({ code: "catalog_changed" });
  });

  it("does not invalidate a pending revision when the provider is unavailable", async () => {
    const offers = REFERENCE_OFFERS.map((offer) => ({
      ...offer,
      revision: 4,
    }));
    const { billing, fake, store } = createWorkflowHarness(
      new Date("2026-01-01T00:00:00.000Z"),
      { seedLocalCatalog: false, offers },
    );
    await billing.recordRequestedCatalog();
    fake.controls.outage = true;
    await expect(billing.verifyRequestedCatalog()).resolves.toMatchObject({
      verified: false,
      revision: 4,
    });
    expect(store.revisions[0]!.status).toBe("pending_verification");
  });

  it("refuses to activate an older requested revision over a newer active catalog", async () => {
    const { billing, store } = createWorkflowHarness();
    store.revisions[0]!.status = "retired";
    store.revisions[0]!.retiredAt = new Date("2026-01-01T00:00:00.000Z");
    store.seedCatalog({
      revision: 2,
      provider: "fake",
      offers: REFERENCE_OFFERS.map((offer) => ({
        ...offer,
        revision: 2,
      })),
      status: "active",
    });
    await expect(billing.verifyRequestedCatalog()).resolves.toEqual({
      verified: false,
      revision: 1,
      mismatches: ["revision_superseded"],
    });
    expect(store.revisions.find((row) => row.revision === 2)?.status).toBe("active");
    expect(store.revisions.find((row) => row.revision === 1)?.status).toBe("retired");
  });

  it("abandons an invalid requested revision and restores checkout on the prior catalog", async () => {
    const { billing, fake, store, now, authorization, audit } = createWorkflowHarness();
    const nextOffers = REFERENCE_OFFERS.map((offer) => ({
      ...offer,
      revision: 2,
    }));
    const pending = createBillingFrom(store, fake, now, nextOffers, {
      authorization,
      audit,
    });
    fake.seedProduct({
      provider: "fake",
      providerProductId: "pdt_pro_month",
      currency: "USD",
      amountMinor: 1,
      interval: "month",
    });
    await pending.verifyRequestedCatalog();
    fake.seedDefaultCatalog();
    const abandoned = await pending.abandonRequestedCatalog({
      actorId: "ops_catalog",
      reason: "revert catalog env",
    });
    expect(abandoned.status).toBe("abandoned");
    expect(
      audit.records.some((record) =>
        record.effectId.startsWith("operator:abandon-catalog:"),
      ),
    ).toBe(true);
    expect((await billing.publicCatalog())?.checkoutAvailable).toBe(true);
    const workspace = entity("ws_catalog_abandon");
    const actor = payer();
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
    expect(checkout.attempt.catalogRevision).toBe(1);
  });

  it("enforces checkout and paid-through deadlines without provider calls", async () => {
    const { billing, fake, store, authorization, audit, now } = createWorkflowHarness();
    const checkoutEntity = entity("ws_expired_checkout");
    const actor = payer();
    const checkoutGrant = grant("checkout", checkoutEntity.id, actor.id, now);
    authorization.issue(checkoutGrant);
    const expiring = await billing.startCheckout({
      grant: checkoutGrant,
      entity: checkoutEntity,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
    });
    expiring.attempt.expiresAt = new Date(now.getTime() - 1);
    expiring.attempt.checkoutUrlEncrypted = "enc:checkout";

    const paidEntity = entity("ws_paid_through");
    const paidGrant = grant("checkout", paidEntity.id, actor.id, now);
    authorization.issue(paidGrant);
    const paidCheckout = await billing.startCheckout({
      grant: paidGrant,
      entity: paidEntity,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
    });
    const snapshot = await fake.simulatePayment(
      paidCheckout.attempt.providerCheckoutSessionId!,
    );
    await billing.projectSnapshot(snapshot, {
      checkoutAttemptId: paidCheckout.attempt.attemptId,
    });
    const subscription = store.subscriptions[0]!;
    subscription.status = "cancelled";
    subscription.cancelAtPeriodEnd = true;
    subscription.paidThroughAt = new Date(now.getTime() - 1);
    const providerCallsBefore = store.providerCallsWhileOpen;
    fake.controls.outage = true;

    await expect(billing.runDeadlineBatch()).resolves.toBe(2);
    expect(expiring.attempt).toMatchObject({
      status: "expired",
      checkoutUrlEncrypted: null,
      completedAt: now,
    });
    expect(subscription.isEntitlementSource).toBe(false);
    await expect(billing.commercialState(paidEntity.id)).resolves.toMatchObject({
      activePaidPlan: null,
      projectionVersion: 2,
    });
    expect(store.providerCallsWhileOpen).toBe(providerCallsBefore);
    expect(
      audit.records.some(
        (record) => record.effectId === `checkout:${expiring.attempt.id}:expired`,
      ),
    ).toBe(true);
  });

  it("purges terminal sensitive values using an application cutoff", async () => {
    const { billing, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_retention");
    const actor = payer();
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
    checkout.attempt.status = "completed";
    checkout.attempt.completedAt = new Date(now.getTime() - 2_000);
    checkout.attempt.checkoutUrlEncrypted = "enc:checkout";
    store.planChanges.push({
      id: "change_row",
      changeId: "change_external",
      billableEntityId: workspace.id,
      subscriptionId: "sub_row",
      actorId: actor.id,
      payerId: actor.id,
      provider: "fake",
      idempotencyKey: "change:key",
      currentCatalogRevision: 1,
      currentPriceEntryId: store.priceEntries[0]!.id,
      currentPlan: "pro",
      currentInterval: "month",
      targetCatalogRevision: 1,
      targetPriceEntryId: store.priceEntries[1]!.id,
      targetPlan: "pro",
      targetInterval: "year",
      targetOfferKey: "pro_year",
      effectiveAt: "immediately",
      prorationMode: "do_not_bill",
      status: "succeeded",
      lastError: null,
      paymentUrlEncrypted: "enc:payment",
      completedAt: new Date(now.getTime() - 2_000),
    });
    store.webhooks.push({
      id: "webhook_row",
      provider: "fake",
      providerEventId: "event_retained",
      eventType: "subscription.active",
      occurredAt: new Date(now.getTime() - 3_000),
      subscriptionId: null,
      checkoutAttemptId: null,
      payloadEncrypted: "enc:payload",
      payloadKeyVersion: "v1",
      verifiedKeyVersion: "v1",
      status: "processed",
      processingAttempts: 1,
      lastError: null,
      availableAt: new Date(now.getTime() - 3_000),
      lockedAt: null,
      leaseExpiresAt: null,
      workerId: null,
      processedAt: new Date(now.getTime() - 2_000),
    });

    await expect(
      billing.purgeExpiredSensitiveValues({
        before: new Date(now.getTime() - 1_000),
      }),
    ).resolves.toEqual({
      checkoutUrls: 1,
      planChangeUrls: 1,
      webhookPayloads: 1,
    });
    expect(checkout.attempt.checkoutUrlEncrypted).toBeNull();
    expect(store.planChanges[0]!.paymentUrlEncrypted).toBeNull();
    expect(store.webhooks[0]!.payloadEncrypted).toBeNull();
    expect(store.webhooks[0]!.payloadKeyVersion).toBeNull();
    await expect(
      billing.purgeExpiredSensitiveValues({
        before: new Date(now.getTime() - 1_000),
      }),
    ).resolves.toEqual({
      checkoutUrls: 0,
      planChangeUrls: 0,
      webhookPayloads: 0,
    });
  });

  it("checkout prepare/call/finalize does not hold a transaction across the provider", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_1");
    const actor = payer();
    const token = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(token);
    const result = await billing.startCheckout({
      grant: token,
      entity: workspace,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
    });
    expect(result.checkoutUrl.startsWith("http")).toBe(true);
    const publicCatalog = await billing.publicCatalog();
    expect(publicCatalog?.offers[0]?.displayTrialDays).toBe(14);
    expect(JSON.stringify(publicCatalog)).not.toContain("providerProductId");
    expect(store.providerCallsWhileOpen).toBe(0);
    expect(store.transactionDepth).toBe(0);
    expect(result.attempt.status).toBe("open");

    const paid = await fake.simulatePayment(result.attempt.providerCheckoutSessionId!);
    const signed = fake.signWebhook(
      JSON.stringify({
        type: "subscription.updated",
        data: {
          subscription_id: paid.providerSubscriptionId,
          metadata: { checkoutAttemptId: result.attempt.attemptId },
        },
      }),
    );
    const ingested = await billing.ingestWebhook({
      provider: "fake",
      raw: signed,
    });
    expect(ingested.duplicate).toBe(false);
    expect(ingested.envelope.subscriptionId).toBe(paid.providerSubscriptionId);
    expect(store.webhooks[0].subscriptionId).toBe(paid.providerSubscriptionId);
    expect(store.webhooks[0].checkoutAttemptId).toBe(result.attempt.attemptId);
    const processed = await billing.runWebhookInboxBatch({
      workerId: "wh-1",
    });
    expect(processed).toBe(1);
    expect(store.webhooks[0].status).toBe("processed");
    const again = await billing.ingestWebhook({
      provider: "fake",
      raw: signed,
    });
    expect(again.duplicate).toBe(true);
    expect(store.subscriptions).toHaveLength(1);
    expect((await billing.commercialState(workspace.id)).projectionVersion).toBe(1);

    await billing.runWebhookInboxBatch({ workerId: "wh-1" });
    expect((await billing.commercialState(workspace.id)).projectionVersion).toBe(1);
  });

  it("records another product's webhook as ignored without processing it", async () => {
    const { billing, fake, store } = createWorkflowHarness();
    const parse = fake.parseWebhook.bind(fake);
    fake.parseWebhook = async (input) => ({ ...(await parse(input)), foreign: true });
    const signed = fake.signWebhook(
      JSON.stringify({
        type: "subscription.updated",
        data: { subscription_id: "sub_other_product" },
      }),
    );

    const ingested = await billing.ingestWebhook({ provider: "fake", raw: signed });
    expect(ingested.duplicate).toBe(false);
    expect(store.webhooks[0].status).toBe("ignored");
    expect(store.webhooks[0].processedAt).toBeInstanceOf(Date);

    expect(await billing.runWebhookInboxBatch({ workerId: "wh-1" })).toBe(0);
    expect(store.webhooks[0].status).toBe("ignored");
    expect(store.webhooks[0].processingAttempts).toBe(0);
    expect(store.subscriptions).toHaveLength(0);

    const again = await billing.ingestWebhook({ provider: "fake", raw: signed });
    expect(again.duplicate).toBe(true);
  });

  it("projects a paid checkout on resume when the webhook never arrived", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_resume_paid");
    const actor = payer("acct_resume_paid");
    const firstGrant = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(firstGrant);
    const first = await billing.startCheckout({
      grant: firstGrant,
      entity: workspace,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
    });
    await fake.simulatePayment(first.attempt.providerCheckoutSessionId!);
    expect(store.subscriptions).toHaveLength(0);
    const resumeGrant = {
      ...grant("checkout", workspace.id, actor.id, now),
      grantId: "grant_resume_paid_checkout",
    };
    authorization.issue(resumeGrant);
    const resumed = await billing.startCheckout({
      grant: resumeGrant,
      entity: workspace,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
    });
    expect(resumed.checkoutUrl).toBe(first.attempt.returnUrl);
    expect(store.subscriptions).toHaveLength(1);
    expect(store.subscriptions[0]!.offerKey).toBe("pro_month");
    expect(store.checkouts[0]!.status).toBe("completed");
    expect((await billing.commercialState(workspace.id)).activePaidPlan).toBe("pro");
  });

  it("does not complete checkout when resume finds only a pending provider subscription", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_resume_pending");
    const actor = payer("acct_resume_pending");
    const firstGrant = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(firstGrant);
    const first = await billing.startCheckout({
      grant: firstGrant,
      entity: workspace,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
    });
    await fake.simulatePendingSubscription(first.attempt.providerCheckoutSessionId!);
    const resumeGrant = {
      ...grant("checkout", workspace.id, actor.id, now),
      grantId: "grant_resume_pending_checkout",
    };
    authorization.issue(resumeGrant);
    const resumed = await billing.startCheckout({
      grant: resumeGrant,
      entity: workspace,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
    });
    expect(resumed.checkoutUrl).toBe(first.checkoutUrl);
    expect(store.checkouts[0]!.status as string).toBe("open");
    expect(store.subscriptions).toHaveLength(0);
    expect((await billing.commercialState(workspace.id)).activePaidPlan).toBeNull();
  });

  it("resumes an unpaid completed checkout instead of colliding on the idempotency key", async () => {
    const { billing, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_resume_completed_unpaid");
    const actor = payer("acct_resume_completed_unpaid");
    const firstGrant = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(firstGrant);
    const first = await billing.startCheckout({
      grant: firstGrant,
      entity: workspace,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
    });
    store.checkouts[0]!.status = "completed";
    store.checkouts[0]!.completedAt = now;
    const resumeGrant = {
      ...grant("checkout", workspace.id, actor.id, now),
      grantId: "grant_resume_completed_unpaid",
    };
    authorization.issue(resumeGrant);
    const resumed = await billing.startCheckout({
      grant: resumeGrant,
      entity: workspace,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
    });
    expect(resumed.checkoutUrl.startsWith("https://")).toBe(true);
    expect(store.checkouts).toHaveLength(1);
    expect(store.checkouts[0]!.status as string).toBe("open");
    expect(store.checkouts[0]!.idempotencyKey).toBe(first.attempt.idempotencyKey);
    expect((await billing.commercialState(workspace.id)).activePaidPlan).toBeNull();
  });

  it("rejects stale catalog before customer or attempt mutation", async () => {
    const { billing, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_1");
    const actor = payer();
    const token = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(token);
    await expect(
      billing.startCheckout({
        grant: token,
        entity: workspace,
        payer: actor,
        offerKey: "pro_month",
        catalogRevision: 99,
        returnUrl: "https://app.test/billing",
      }),
    ).rejects.toMatchObject({ code: "catalog_changed" });
    expect(store.customers).toHaveLength(0);
    expect(store.checkouts).toHaveLength(0);
  });

  it("consumes a grant once and persists payer_mismatch", async () => {
    const { billing, fake, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_1");
    const actor = payer("acct_a");
    const other = payer("acct_b");
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
    await expect(
      billing.startCheckout({
        grant: token,
        entity: workspace,
        payer: actor,
        offerKey: "business_month",
        catalogRevision: 1,
        returnUrl: "https://app.test/billing",
      }),
    ).rejects.toMatchObject({ code: "grant_consumed" });

    const paid = await fake.simulatePayment(
      checkout.attempt.providerCheckoutSessionId!,
    );
    await billing.projectSnapshot(paid, {
      checkoutAttemptId: checkout.attempt.attemptId,
    });
    const portalGrant = grant("portal", workspace.id, other.id, now);
    authorization.issue(portalGrant);
    await expect(
      billing.startPortal({
        grant: portalGrant,
        entity: workspace,
        payer: other,
        returnUrl: "https://app.test/billing",
      }),
    ).rejects.toMatchObject({ code: "payer_mismatch" });
  });

  it("rejects a grant whose actor is not the persisted payer", async () => {
    const { billing, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_actor");
    const actor = payer("acct_actor");
    const substituted = payer("acct_substituted");
    const token = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(token);
    await expect(
      billing.startCheckout({
        grant: token,
        entity: workspace,
        payer: substituted,
        offerKey: "pro_month",
        catalogRevision: 1,
        returnUrl: "https://app.test/billing",
      }),
    ).rejects.toMatchObject({ code: "grant_invalid" });
    expect(store.checkouts).toHaveLength(0);
  });

  it("replaces the payer's open checkout when they choose another offer", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_switch_offer");
    const actor = payer("acct_switch_offer");
    let grants = 0;
    const start = (offerKey: string) => {
      const token = {
        ...grant("checkout", workspace.id, actor.id, now),
        grantId: `grant_switch_${++grants}`,
      };
      authorization.issue(token);
      return billing.startCheckout({
        grant: token,
        entity: workspace,
        payer: actor,
        offerKey,
        catalogRevision: 1,
        returnUrl: "https://app.test/billing",
      });
    };
    const yearly = await start("pro_year");
    const monthly = await start("pro_month");
    expect(monthly.attempt.id).not.toBe(yearly.attempt.id);
    expect(monthly.checkoutUrl).not.toBe(yearly.checkoutUrl);
    expect(store.checkouts.find((row) => row.id === yearly.attempt.id)?.status).toBe(
      "abandoned",
    );
    expect(monthly.attempt.status).toBe("open");
    expect(fake.createCheckoutCalls.at(-1)?.expiresAt).toEqual(
      monthly.attempt.expiresAt,
    );

    // Back to yearly: the abandoned attempt keeps its key, so a new one opens.
    const yearlyAgain = await start("pro_year");
    expect(yearlyAgain.attempt.id).not.toBe(yearly.attempt.id);
    expect(yearlyAgain.attempt.idempotencyKey).not.toBe(yearly.attempt.idempotencyKey);
    expect(store.checkouts.filter((row) => row.status === "open")).toHaveLength(1);

    // Choosing the same offer again reopens the same checkout.
    const same = await start("pro_year");
    expect(same.attempt.id).toBe(yearlyAgain.attempt.id);
    expect(same.checkoutUrl).toBe(yearlyAgain.checkoutUrl);
  });

  it("replaces the open checkout when reopening an expired one for another offer", async () => {
    const { billing, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_switch_expired");
    const actor = payer("acct_switch_expired");
    let grants = 0;
    const start = (offerKey: string) => {
      const token = {
        ...grant("checkout", workspace.id, actor.id, now),
        grantId: `grant_switch_expired_${++grants}`,
      };
      authorization.issue(token);
      return billing.startCheckout({
        grant: token,
        entity: workspace,
        payer: actor,
        offerKey,
        catalogRevision: 1,
        returnUrl: "https://app.test/billing",
      });
    };
    const yearly = await start("pro_year");
    const expired = store.checkouts.find((row) => row.id === yearly.attempt.id)!;
    expired.status = "expired";
    expired.completedAt = now;
    const monthly = await start("pro_month");
    const reopened = await start("pro_year");
    expect(reopened.attempt.id).toBe(yearly.attempt.id);
    expect(reopened.attempt.status).toBe("open");
    expect(store.checkouts.find((row) => row.id === monthly.attempt.id)?.status).toBe(
      "abandoned",
    );
    expect(store.checkouts.filter((row) => row.status === "open")).toHaveLength(1);
  });

  it("keeps checkout_pending for another payer's open checkout", async () => {
    const { billing, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_other_payer");
    const owner = payer("acct_owner");
    const other = payer("acct_other");
    const ownerGrant = grant("checkout", workspace.id, owner.id, now);
    authorization.issue(ownerGrant);
    await billing.startCheckout({
      grant: ownerGrant,
      entity: workspace,
      payer: owner,
      offerKey: "pro_year",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
    });
    const otherGrant = {
      ...grant("checkout", workspace.id, other.id, now),
      grantId: "grant_other_payer",
    };
    authorization.issue(otherGrant);
    await expect(
      billing.startCheckout({
        grant: otherGrant,
        entity: workspace,
        payer: other,
        offerKey: "pro_month",
        catalogRevision: 1,
        returnUrl: "https://app.test/billing",
      }),
    ).rejects.toMatchObject({ code: "checkout_pending" });
  });

  it("flags a replaced checkout that is paid anyway", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_late_paid");
    const actor = payer("acct_late_paid");
    let grants = 0;
    const start = (offerKey: string) => {
      const token = {
        ...grant("checkout", workspace.id, actor.id, now),
        grantId: `grant_late_${++grants}`,
      };
      authorization.issue(token);
      return billing.startCheckout({
        grant: token,
        entity: workspace,
        payer: actor,
        offerKey,
        catalogRevision: 1,
        returnUrl: "https://app.test/billing",
      });
    };
    const yearly = await start("pro_year");
    const monthly = await start("pro_month");

    // The old page was still open and the payer paid on it.
    const paidYearly = await fake.simulatePayment(
      yearly.attempt.providerCheckoutSessionId!,
    );
    await billing.projectSnapshot(paidYearly, {
      checkoutAttemptId: yearly.attempt.attemptId,
    });
    expect(store.checkouts.find((row) => row.id === yearly.attempt.id)?.status).toBe(
      "conflicted",
    );
    const state = await billing.commercialState(workspace.id);
    expect(state.activePaidPlan).toBe("pro");
    expect(state.billingInterval).toBe("year");

    // Paying on both pages leaves the second subscription for an operator.
    const paidMonthly = await fake.simulatePayment(
      monthly.attempt.providerCheckoutSessionId!,
    );
    await expect(
      billing.projectSnapshot(paidMonthly, {
        checkoutAttemptId: monthly.attempt.attemptId,
      }),
    ).rejects.toMatchObject({ code: "operation_quarantined" });
    expect((await billing.commercialState(workspace.id)).billingInterval).toBe("year");
  });

  it("follows the customer a provider picks at checkout", async () => {
    for (const assigns of [true, false]) {
      const { billing, fake, store, authorization, now } = createWorkflowHarness();
      fake.capabilities.checkoutAssignsCustomer = assigns;
      const workspace = entity(`ws_checkout_customer_${assigns}`);
      const actor = payer(`acct_checkout_customer_${assigns}`);
      const token = grant("checkout", workspace.id, actor.id, now);
      authorization.issue(token);
      const checkout = await billing.startCheckout({
        grant: token,
        entity: workspace,
        payer: actor,
        offerKey: "pro_year",
        catalogRevision: 1,
        returnUrl: "https://app.test/billing",
      });
      const paid = await fake.simulatePayment(
        checkout.attempt.providerCheckoutSessionId!,
      );
      const projected = billing.projectSnapshot(
        { ...paid, providerCustomerId: "cus_chosen_at_checkout" },
        { checkoutAttemptId: checkout.attempt.attemptId },
      );
      if (!assigns) {
        await expect(projected).rejects.toMatchObject({
          code: "operation_quarantined",
        });
        continue;
      }
      await projected;
      expect(store.customers[0]!.providerCustomerId).toBe("cus_chosen_at_checkout");
      expect((await billing.commercialState(workspace.id)).activePaidPlan).toBe("pro");
    }
  });

  it("two billable entities under one payer transition independently", async () => {
    const { billing, fake, authorization, now } = createWorkflowHarness();
    const actor = payer();
    const schoolA = entity("school_a", "school");
    const schoolB = entity("school_b", "school");
    const grantA = {
      ...grant("checkout", schoolA.id, actor.id, now),
      target: { kind: "school", id: schoolA.id },
    };
    const grantB = {
      ...grant("checkout", schoolB.id, actor.id, now),
      grantId: "grant_b",
      target: { kind: "school", id: schoolB.id },
    };
    authorization.issue(grantA);
    authorization.issue(grantB);
    const a = await billing.startCheckout({
      grant: grantA,
      entity: schoolA,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/a",
    });
    const b = await billing.startCheckout({
      grant: grantB,
      entity: schoolB,
      payer: actor,
      offerKey: "business_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/b",
    });
    const paidA = await fake.simulatePayment(a.attempt.providerCheckoutSessionId!);
    await billing.projectSnapshot(paidA, {
      checkoutAttemptId: a.attempt.attemptId,
    });
    expect((await billing.commercialState(schoolA.id)).activePaidPlan).toBe("pro");
    expect((await billing.commercialState(schoolB.id)).activePaidPlan).toBeNull();
    const paidB = await fake.simulatePayment(b.attempt.providerCheckoutSessionId!);
    await billing.projectSnapshot(paidB, {
      checkoutAttemptId: b.attempt.attemptId,
    });
    expect((await billing.commercialState(schoolB.id)).activePaidPlan).toBe("business");
    expect(courselitShapedCatalog().applicationFreePlan).toBeNull();
    expect(sendlitShapedCatalog().applicationFreePlan).toBe("free");
  });

  it("inbox batch projects a first payment from persisted envelope subscription id", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_first");
    const actor = payer();
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
    expect(store.subscriptions).toHaveLength(0);
    const paid = await fake.simulatePayment(
      checkout.attempt.providerCheckoutSessionId!,
    );
    const signed = fake.signWebhook(
      JSON.stringify({
        type: "subscription.active",
        data: {
          subscription_id: paid.providerSubscriptionId,
          metadata: { checkoutAttemptId: checkout.attempt.attemptId },
        },
      }),
    );
    await billing.ingestWebhook({ provider: "fake", raw: signed });
    await billing.runWebhookInboxBatch({ workerId: "wh-first" });
    expect(store.webhooks[0].status).toBe("processed");
    expect(store.subscriptions).toHaveLength(1);
    expect(store.subscriptions[0].providerSubscriptionId).toBe(
      paid.providerSubscriptionId,
    );
    expect(store.subscriptions[0].originCheckoutAttemptId).toBe(checkout.attempt.id);
    expect(store.checkouts[0].status).toBe("completed");
    expect((await billing.commercialState(workspace.id)).activePaidPlan).toBe("pro");
  });

  it("quarantines an uncorrelated provider product change", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_1");
    const actor = payer();
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
    await billing.projectSnapshot(paid, {
      checkoutAttemptId: checkout.attempt.attemptId,
    });
    await fake.changeSubscriptionPlan({
      providerSubscriptionId: paid.providerSubscriptionId,
      targetProviderProductId: "pdt_business_month",
      effectiveAt: "immediately",
      prorationMode: "prorated_immediately",
      idempotencyKey: "pc-1",
    });
    const stale = fake.signWebhook(
      JSON.stringify({
        type: "subscription.updated",
        data: {
          subscription_id: paid.providerSubscriptionId,
          product_id: "pdt_pro_month",
          status: "active",
        },
      }),
      "evt_stale_payload",
      new Date(now.getTime() - 30_000),
    );
    const ingested = await billing.ingestWebhook({
      provider: "fake",
      raw: stale,
    });
    expect(ingested.envelope.subscriptionId).toBe(paid.providerSubscriptionId);
    await billing.runWebhookInboxBatch({ workerId: "wh-delayed" });
    const sub = store.subscriptions[0];
    expect(sub.providerProductId).toBe("pdt_pro_month");
    expect(store.webhooks[0].status).toBe("quarantined");
  });

  it("does not regress a subscription from an older provider snapshot", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_order");
    const actor = payer();
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
    await billing.projectSnapshot(
      {
        ...paid,
        status: "active",
        providerVersion: "2",
        providerOccurredAt: new Date("2026-01-02T00:00:00Z"),
        observedAt: new Date("2026-01-02T00:00:01Z"),
      },
      { checkoutAttemptId: checkout.attempt.attemptId },
    );
    await billing.projectSnapshot(
      {
        ...paid,
        status: "past_due",
        providerVersion: "1",
        providerOccurredAt: new Date("2026-01-01T00:00:00Z"),
        observedAt: new Date("2026-01-03T00:00:00Z"),
      },
      {},
    );
    expect(store.subscriptions[0].status).toBe("active");
    expect(store.subscriptions[0].providerVersion).toBe("2");
  });

  it("clears the active subscription pointer when the subscription ends", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_cancel");
    const actor = payer();
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
    await billing.projectSnapshot(paid, {
      checkoutAttemptId: checkout.attempt.attemptId,
    });
    await fake.cancelSubscription(paid.providerSubscriptionId, "cancel:test");
    await billing.projectSnapshot(
      fake.endScheduledCancellation(paid.providerSubscriptionId),
      {},
    );
    expect(store.planStates.get(workspace.id)?.activeSubscriptionId).toBeNull();
    expect((await billing.commercialState(workspace.id)).activePaidPlan).toBeNull();
  });

  it("retries a cancellation after an ambiguous provider timeout", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_cancel_retry");
    const actor = payer("acct_cancel_retry");
    const checkoutGrant = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(checkoutGrant);
    const checkout = await billing.startCheckout({
      grant: checkoutGrant,
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

    const cancelGrant = grant("cancellation", workspace.id, actor.id, now);
    authorization.issue(cancelGrant);
    fake.controls.timeoutAfter = { cancellation: true };
    await expect(
      billing.cancel({
        grant: cancelGrant,
        entity: workspace,
        payer: actor,
      }),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(store.jobs[0]?.operation).toBe("cancellation");

    await billing.runReconciliationBatch({ workerId: "w-cancel" });
    expect(store.subscriptions[0].status).toBe("active");
    expect(store.subscriptions[0].cancelAtPeriodEnd).toBe(true);
    expect(store.planStates.get(workspace.id)?.activeSubscriptionId).toBe(
      store.subscriptions[0].id,
    );
    expect(store.jobs[0]?.status).toBe("completed");
  });

  it("keeps paid access until the period ends after a cancel, and resumes", async () => {
    const { billing, fake, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_cancel_period_end");
    const actor = payer("acct_cancel_period_end");
    const checkoutGrant = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(checkoutGrant);
    const checkout = await billing.startCheckout({
      grant: checkoutGrant,
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

    const cancelGrant = grant("cancellation", workspace.id, actor.id, now);
    authorization.issue(cancelGrant);
    await billing.cancel({ grant: cancelGrant, entity: workspace, payer: actor });
    await billing.projectSnapshot(
      await fake.retrieveSubscription(paid.providerSubscriptionId),
      {},
    );
    const scheduled = await billing.commercialState(workspace.id);
    expect(scheduled.activePaidPlan).toBe("pro");
    expect(scheduled.cancelAtPeriodEnd).toBe(true);
    expect(scheduled.paidThroughAt).toEqual(paid.paidThroughAt);

    const resumeGrant = grant(
      "cancellation",
      workspace.id,
      actor.id,
      new Date(now.getTime() - 1),
    );
    authorization.issue(resumeGrant);
    await billing.resumeCancellation({
      grant: resumeGrant,
      entity: workspace,
      payer: actor,
    });
    await billing.projectSnapshot(
      await fake.retrieveSubscription(paid.providerSubscriptionId),
      {},
    );
    const resumed = await billing.commercialState(workspace.id);
    expect(resumed.activePaidPlan).toBe("pro");
    expect(resumed.cancelAtPeriodEnd).toBe(false);

    // Cancelling again after a resume is a new provider request.
    const againGrant = grant(
      "cancellation",
      workspace.id,
      actor.id,
      new Date(now.getTime() - 2),
    );
    authorization.issue(againGrant);
    await billing.cancel({ grant: againGrant, entity: workspace, payer: actor });
    await billing.projectSnapshot(
      await fake.retrieveSubscription(paid.providerSubscriptionId),
      {},
    );
    expect((await billing.commercialState(workspace.id)).cancelAtPeriodEnd).toBe(true);

    // At period end the provider ends the subscription and access stops.
    await billing.projectSnapshot(
      fake.endScheduledCancellation(paid.providerSubscriptionId),
      {},
    );
    expect((await billing.commercialState(workspace.id)).activePaidPlan).toBeNull();
  });

  it("resumes a cancellation a provider reports as cancelled until the period ends", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_resume_cancelled_status");
    const actor = payer("acct_resume_cancelled_status");
    const checkoutGrant = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(checkoutGrant);
    const checkout = await billing.startCheckout({
      grant: checkoutGrant,
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
    await fake.cancelSubscription(paid.providerSubscriptionId, "cancel_at_provider");
    // Projected the way Lemon Squeezy reports it: `cancelled`, paid until the end.
    await billing.projectSnapshot(
      {
        ...(await fake.retrieveSubscription(paid.providerSubscriptionId)),
        status: "cancelled",
        cancelAtPeriodEnd: true,
      },
      {},
    );
    expect(store.subscriptions[0]!.status).toBe("cancelled");
    expect((await billing.commercialState(workspace.id)).activePaidPlan).toBe("pro");

    const resumeGrant = {
      ...grant("cancellation", workspace.id, actor.id, now),
      grantId: "grant_resume_cancelled_status",
    };
    authorization.issue(resumeGrant);
    await billing.resumeCancellation({
      grant: resumeGrant,
      entity: workspace,
      payer: actor,
    });
    const resumed = await billing.commercialState(workspace.id);
    expect(resumed.activePaidPlan).toBe("pro");
    expect(resumed.cancelAtPeriodEnd).toBe(false);
    expect(store.subscriptions[0]!.status).toBe("active");
  });

  it("reads back a cancel and lapses paid access when the period passes", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_lapse");
    const actor = payer("acct_lapse");
    const checkoutGrant = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(checkoutGrant);
    const checkout = await billing.startCheckout({
      grant: checkoutGrant,
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

    const cancelGrant = grant("cancellation", workspace.id, actor.id, now);
    authorization.issue(cancelGrant);
    await billing.cancel({ grant: cancelGrant, entity: workspace, payer: actor });
    // No webhook or manual projection: cancel reads the subscription back.
    const scheduled = await billing.commercialState(workspace.id);
    expect(scheduled.cancelAtPeriodEnd).toBe(true);
    expect(scheduled.activePaidPlan).toBe("pro");

    // The provider's final event never arrives, and the period passes.
    const later = new Date(paid.paidThroughAt!.getTime() + 1000);
    const afterPeriod = createBillingFrom(store, fake, later, REFERENCE_OFFERS, {
      authorization,
    });
    expect((await afterPeriod.commercialState(workspace.id)).activePaidPlan).toBeNull();

    expect(await afterPeriod.runDeadlineBatch()).toBe(1);
    expect(store.planStates.get(workspace.id)?.activeSubscriptionId).toBeNull();
    expect(
      store.jobs.some((job) => job.subscriptionId === store.subscriptions[0].id),
    ).toBe(true);

    // A new checkout is allowed once access has lapsed.
    const again = grant("checkout", workspace.id, actor.id, later);
    authorization.issue(again);
    await expect(
      afterPeriod.startCheckout({
        grant: again,
        entity: workspace,
        payer: actor,
        offerKey: "pro_month",
        catalogRevision: 1,
        returnUrl: "https://app.test/billing",
      }),
    ).resolves.toBeDefined();
  });

  it("discovers subscriptions that were never reconciled", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_discover");
    const actor = payer("acct_discover");
    const checkoutGrant = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(checkoutGrant);
    const checkout = await billing.startCheckout({
      grant: checkoutGrant,
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
    expect(store.subscriptions[0].lastReconciledAt).toBeNull();

    await billing.runReconciliationBatch({ workerId: "w-off", discover: false });
    expect(store.jobs).toHaveLength(0);

    await billing.runReconciliationBatch({ workerId: "w-on" });
    expect(store.subscriptions[0].lastReconciledAt).toBeInstanceOf(Date);
    expect(
      (await billing.commercialState(workspace.id, { transaction: {} })).activePaidPlan,
    ).toBe("pro");
  });

  it("adopts a subscription started outside the engine", async () => {
    const { billing, fake, store, authorization, audit, now } = createWorkflowHarness();
    const workspace = entity("ws_adopt");
    const actor = payer("acct_adopt");
    const operator = { actorId: "op_1", reason: "migrate an existing subscription" };
    const external = fake.createExternalSubscription({
      customerId: "cus_external",
      productId: "pdt_pro_month",
    });

    const adopted = await billing.adoptProviderSubscription(operator, {
      providerName: "fake",
      providerSubscriptionId: external.providerSubscriptionId,
      entity: workspace,
      payer: actor,
    });
    expect(adopted.subscription.billableEntityId).toBe(workspace.id);
    const state = await billing.commercialState(workspace.id);
    expect(state.activePaidPlan).toBe("pro");
    expect(state.provider).toBe("fake");
    expect(store.customers).toHaveLength(1);
    expect(
      audit.records.some((row) => row.effectId.startsWith("operator:adopt:")),
    ).toBe(true);

    // Repeating it is safe; another entity cannot take it.
    await billing.adoptProviderSubscription(operator, {
      providerName: "fake",
      providerSubscriptionId: external.providerSubscriptionId,
      entity: workspace,
      payer: actor,
    });
    expect(store.customers).toHaveLength(1);
    expect(store.subscriptions).toHaveLength(1);
    await expect(
      billing.adoptProviderSubscription(operator, {
        providerName: "fake",
        providerSubscriptionId: external.providerSubscriptionId,
        entity: entity("ws_other"),
        payer: payer("acct_other"),
      }),
    ).rejects.toMatchObject({ code: "operation_conflicted" });

    // From then on the usual workflows apply.
    const cancelGrant = grant("cancellation", workspace.id, actor.id, now);
    authorization.issue(cancelGrant);
    await billing.cancel({ grant: cancelGrant, entity: workspace, payer: actor });
    expect((await billing.commercialState(workspace.id)).cancelAtPeriodEnd).toBe(true);
  });

  it("refuses to adopt a subscription whose product is not in the catalog", async () => {
    const { billing, fake } = createWorkflowHarness();
    const external = fake.createExternalSubscription({
      customerId: "cus_unknown",
      productId: "pdt_not_in_catalog",
    });
    await expect(
      billing.adoptProviderSubscription(
        { actorId: "op_1", reason: "migrate" },
        {
          providerName: "fake",
          providerSubscriptionId: external.providerSubscriptionId,
          entity: entity("ws_unknown"),
          payer: payer("acct_unknown"),
        },
      ),
    ).rejects.toMatchObject({ code: "operation_quarantined" });
  });

  it("refuses to adopt a subscription whose product only a retired revision sold", async () => {
    const { billing, fake, store } = createWorkflowHarness(undefined, {
      seedLocalCatalog: false,
    });
    store.seedCatalog({
      revision: 1,
      provider: "fake",
      offers: REFERENCE_OFFERS,
      status: "retired",
    });
    store.seedCatalog({
      revision: 2,
      provider: "fake",
      offers: REFERENCE_OFFERS.filter((offer) => offer.key !== "pro_month").map(
        (offer) => ({ ...offer, revision: 2 }),
      ),
    });
    const external = fake.createExternalSubscription({
      customerId: "cus_retired",
      productId: "pdt_pro_month",
    });
    await expect(
      billing.adoptProviderSubscription(
        { actorId: "op_1", reason: "migrate" },
        {
          providerName: "fake",
          providerSubscriptionId: external.providerSubscriptionId,
          entity: entity("ws_retired"),
          payer: payer("acct_retired"),
        },
      ),
    ).rejects.toMatchObject({ code: "operation_quarantined" });
    expect(store.subscriptions).toHaveLength(0);
  });

  it("stops a pending cancellation retry when the user resumes", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_resume_retry");
    const actor = payer("acct_resume_retry");
    const checkoutGrant = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(checkoutGrant);
    const checkout = await billing.startCheckout({
      grant: checkoutGrant,
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

    // The cancel reaches the provider but the response times out.
    const cancelGrant = grant("cancellation", workspace.id, actor.id, now);
    authorization.issue(cancelGrant);
    fake.controls.timeoutAfter = { cancellation: true };
    await expect(
      billing.cancel({ grant: cancelGrant, entity: workspace, payer: actor }),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    fake.controls.timeoutAfter = {};
    await billing.projectSnapshot(
      await fake.retrieveSubscription(paid.providerSubscriptionId),
      {},
    );

    const resumeGrant = grant(
      "cancellation",
      workspace.id,
      actor.id,
      new Date(now.getTime() - 1),
    );
    authorization.issue(resumeGrant);
    await billing.resumeCancellation({
      grant: resumeGrant,
      entity: workspace,
      payer: actor,
    });
    expect(store.jobs[0]?.operation).toBe("reconcile");

    await billing.runReconciliationBatch({ workerId: "w-resume" });
    expect(store.subscriptions[0].cancelAtPeriodEnd).toBe(false);
    expect((await billing.commercialState(workspace.id)).activePaidPlan).toBe("pro");
  });

  it("asks the user to retry a resume while a worker is sending the cancellation", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_resume_claimed");
    const actor = payer("acct_resume_claimed");
    const checkoutGrant = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(checkoutGrant);
    const checkout = await billing.startCheckout({
      grant: checkoutGrant,
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
    const cancelGrant = grant("cancellation", workspace.id, actor.id, now);
    authorization.issue(cancelGrant);
    fake.controls.timeoutAfter = { cancellation: true };
    await expect(
      billing.cancel({ grant: cancelGrant, entity: workspace, payer: actor }),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    fake.controls.timeoutAfter = {};
    await billing.projectSnapshot(
      await fake.retrieveSubscription(paid.providerSubscriptionId),
      {},
    );
    await billing.claimReconciliationJobs({ workerId: "w-cancel" });

    const resumeGrant = {
      ...grant("cancellation", workspace.id, actor.id, now),
      grantId: "grant_resume_claimed",
    };
    authorization.issue(resumeGrant);
    await expect(
      billing.resumeCancellation({
        grant: resumeGrant,
        entity: workspace,
        payer: actor,
      }),
    ).rejects.toMatchObject({ code: "operation_conflicted", retryable: true });
    expect(store.jobs[0]?.operation).toBe("cancellation");
  });

  it("projects an immediate plan change using the target lineage", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_plan_change");
    const actor = payer();
    const checkoutGrant = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(checkoutGrant);
    const checkout = await billing.startCheckout({
      grant: checkoutGrant,
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
    const changeGrant = grant("plan_change", workspace.id, actor.id, now);
    authorization.issue(changeGrant);
    const change = await billing.startPlanChange({
      grant: changeGrant,
      entity: workspace,
      payer: actor,
      offerKey: "business_month",
      catalogRevision: 1,
      effectiveAt: "immediately",
      prorationMode: "prorated_immediately",
    });
    expect(change.targetOfferKey).toBe("business_month");
    await billing.projectSnapshot(
      await fake.retrieveSubscription(paid.providerSubscriptionId),
      {},
    );
    expect(store.subscriptions[0].offerKey).toBe("business_month");
    expect(store.planChanges[0].status).toBe("succeeded");
    expect(store.planChanges[0].completedAt).toEqual(now);
  });

  it("projects a plan change even when the webhook still names the origin checkout", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_plan_change_checkout_meta");
    const actor = payer("acct_plan_change_meta");
    const checkoutGrant = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(checkoutGrant);
    const checkout = await billing.startCheckout({
      grant: checkoutGrant,
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
    const changeGrant = grant("plan_change", workspace.id, actor.id, now);
    authorization.issue(changeGrant);
    await billing.startPlanChange({
      grant: changeGrant,
      entity: workspace,
      payer: actor,
      offerKey: "business_month",
      catalogRevision: 1,
      effectiveAt: "immediately",
      prorationMode: "prorated_immediately",
    });
    await billing.projectSnapshot(
      await fake.retrieveSubscription(paid.providerSubscriptionId),
      { checkoutAttemptId: checkout.attempt.attemptId },
    );
    expect(store.subscriptions[0].offerKey).toBe("business_month");
    expect(store.planChanges[0].status).toBe("succeeded");
    expect(store.checkouts[0].status).toBe("completed");
    expect(store.checkouts[0].offerKey).toBe("pro_month");
  });

  it("changes back and forth between offers more than once", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_plan_change_repeat");
    const actor = payer("acct_plan_change_repeat");
    const checkoutGrant = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(checkoutGrant);
    const checkout = await billing.startCheckout({
      grant: checkoutGrant,
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
    for (const [step, offerKey] of ["pro_year", "pro_month", "pro_year"].entries()) {
      const changeGrant = {
        ...grant("plan_change", workspace.id, actor.id, now),
        grantId: `grant_plan_change_repeat_${step}`,
      };
      authorization.issue(changeGrant);
      await billing.startPlanChange({
        grant: changeGrant,
        entity: workspace,
        payer: actor,
        offerKey,
        catalogRevision: 1,
        effectiveAt: "immediately",
        prorationMode: "prorated_immediately",
      });
      await billing.projectSnapshot(
        await fake.retrieveSubscription(paid.providerSubscriptionId),
        {},
      );
      expect(store.subscriptions[0].offerKey).toBe(offerKey);
    }
    expect(store.planChanges.map((change) => change.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    expect(new Set(store.planChanges.map((change) => change.idempotencyKey)).size).toBe(
      3,
    );
  });

  it("refuses do_not_bill across intervals when the provider bills such a change at once", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    fake.capabilities.intervalChangesBillImmediately = true;
    const workspace = entity("ws_plan_change_unbilled");
    const actor = payer("acct_plan_change_unbilled");
    const checkoutGrant = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(checkoutGrant);
    const checkout = await billing.startCheckout({
      grant: checkoutGrant,
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
    const yearGrant = grant("plan_change", workspace.id, actor.id, now);
    authorization.issue(yearGrant);
    await expect(
      billing.startPlanChange({
        grant: yearGrant,
        entity: workspace,
        payer: actor,
        offerKey: "pro_year",
        catalogRevision: 1,
        effectiveAt: "immediately",
        prorationMode: "do_not_bill",
      }),
    ).rejects.toMatchObject({ code: "plan_change_not_supported" });
    expect(store.planChanges).toHaveLength(0);

    const sameIntervalGrant = {
      ...grant("plan_change", workspace.id, actor.id, now),
      grantId: "grant_plan_change_same_interval",
    };
    authorization.issue(sameIntervalGrant);
    const change = await billing.startPlanChange({
      grant: sameIntervalGrant,
      entity: workspace,
      payer: actor,
      offerKey: "business_month",
      catalogRevision: 1,
      effectiveAt: "immediately",
      prorationMode: "do_not_bill",
    });
    expect(change.targetOfferKey).toBe("business_month");
  });

  it("refuses a scheduled plan change when the provider applies changes at once", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    fake.capabilities.immediatePlanChangesOnly = true;
    const workspace = entity("ws_plan_change_scheduled");
    const actor = payer("acct_plan_change_scheduled");
    const checkoutGrant = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(checkoutGrant);
    const checkout = await billing.startCheckout({
      grant: checkoutGrant,
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
    const changeGrant = grant("plan_change", workspace.id, actor.id, now);
    authorization.issue(changeGrant);
    await expect(
      billing.startPlanChange({
        grant: changeGrant,
        entity: workspace,
        payer: actor,
        offerKey: "business_month",
        catalogRevision: 1,
        effectiveAt: "next_billing_date",
        prorationMode: "do_not_bill",
      }),
    ).rejects.toMatchObject({ code: "plan_change_not_supported" });
    expect(store.planChanges).toHaveLength(0);
    expect(store.jobs).toHaveLength(0);
  });

  it("rejects unsafe return URLs before provider mutation", async () => {
    const { billing, fake, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_url");
    const actor = payer();
    const token = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(token);
    await expect(
      billing.startCheckout({
        grant: token,
        entity: workspace,
        payer: actor,
        offerKey: "pro_month",
        catalogRevision: 1,
        returnUrl: "javascript:alert(1)",
      }),
    ).rejects.toMatchObject({ code: "invalid_return_url" });
    expect(fake.createCheckoutCalls).toHaveLength(0);
  });

  it("recovers remote success + local finalize failure via reconciliation with the original key", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_1");
    const actor = payer();
    const token = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(token);
    store.failOnTransaction = 4;
    await expect(
      billing.startCheckout({
        grant: token,
        entity: workspace,
        payer: actor,
        offerKey: "pro_month",
        catalogRevision: 1,
        returnUrl: "https://app.test/billing",
      }),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(store.jobs.length).toBeGreaterThan(0);
    const attempt = store.checkouts[0];
    expect(attempt.status).toBe("creating");
    const key = attempt.idempotencyKey;
    await billing.runReconciliationBatch({ workerId: "w1" });
    expect(store.checkouts[0].status).toBe("open");
    expect(store.checkouts[0].idempotencyKey).toBe(key);
    expect(store.checkouts[0].providerCheckoutSessionId).toBeTruthy();
    expect(fake.lastCreateCheckoutInput?.payerEmail).toBe(actor.email);
    expect(fake.lastCreateCheckoutInput?.idempotencyKey).toBe(key);
    expect(fake.lastCreateCustomerInput?.email).toBe(actor.email);
  });

  it("reconciliation retries createCustomer with stored payer email and original key", async () => {
    const { billing, fake, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_email");
    const actor = payer("acct_email");
    const token = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(token);
    store.failOnTransaction = 3;
    await expect(
      billing.startCheckout({
        grant: token,
        entity: workspace,
        payer: actor,
        offerKey: "pro_month",
        catalogRevision: 1,
        returnUrl: "https://app.test/return",
      }),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    const customer = store.customers[0];
    expect(customer.payerEmail).toBe(actor.email);
    const customerKey = customer.idempotencyKey;
    const customersBefore = fake.createCustomerCalls.length;
    const checkoutsBefore = fake.createCheckoutCalls.length;
    await billing.runReconciliationBatch({ workerId: "w-email" });
    expect(fake.createCustomerCalls[customersBefore]?.email).toBe(actor.email);
    expect(fake.createCustomerCalls[customersBefore]?.idempotencyKey).toBe(customerKey);
    expect(fake.createCheckoutCalls[checkoutsBefore]?.payerEmail).toBe(actor.email);
    expect(fake.createCheckoutCalls[checkoutsBefore]?.returnUrl).toBe(
      "https://app.test/return",
    );
  });

  it("leases are exclusive, expire, and reclaim after a crash", async () => {
    const { billing, store, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_1");
    const actor = payer();
    const token = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(token);
    store.failOnTransaction = 4;
    await expect(
      billing.startCheckout({
        grant: token,
        entity: workspace,
        payer: actor,
        offerKey: "pro_month",
        catalogRevision: 1,
        returnUrl: "https://app.test/billing",
      }),
    ).rejects.toThrow();
    const first = await billing.claimReconciliationJobs({
      workerId: "w-crash",
      limit: 10,
    });
    expect(first.length).toBeGreaterThan(0);
    const locked = await billing.claimReconciliationJobs({
      workerId: "w-other",
      limit: 10,
    });
    expect(locked).toHaveLength(0);
    for (const job of store.jobs) {
      if (job.workerId === "w-crash") {
        job.leaseExpiresAt = new Date(now.getTime() - 1);
      }
    }
    const reclaimed = await billing.claimReconciliationJobs({
      workerId: "w-new",
      limit: 10,
    });
    expect(reclaimed.length).toBeGreaterThan(0);
    expect(reclaimed[0].workerId).toBe("w-new");
  });

  it("reports lifecycle blockers without remote cancellation", async () => {
    const { billing, fake, authorization, now } = createWorkflowHarness();
    const workspace = entity("ws_1");
    const actor = payer();
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
    expect(await billing.getBillableEntityBillingBlockers(workspace, now)).toContain(
      "live_checkout",
    );
    const paid = await fake.simulatePayment(
      checkout.attempt.providerCheckoutSessionId!,
    );
    await billing.projectSnapshot(paid, {
      checkoutAttemptId: checkout.attempt.attemptId,
    });
    const blockers = await billing.getBillableEntityBillingBlockers(workspace, now);
    expect(blockers).toContain("nonterminal_subscription");
    expect(blockers).toContain("future_paid_entitlement");
    const responsibilities = await billing.getPayerBillingResponsibilities(actor, now);
    expect(responsibilities[0]?.subscriptionIds.length).toBe(1);
    expect(fake.controls.outage).toBeFalsy();
  });

  it("material change audits once; equivalent refresh does not", async () => {
    const { billing, fake, authorization, audit, now } = createWorkflowHarness();
    const workspace = entity("ws_1");
    const actor = payer();
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
    await billing.projectSnapshot(paid, {
      checkoutAttemptId: checkout.attempt.attemptId,
    });
    const materialAudits = audit.records.filter((row) =>
      row.effectId.startsWith("projection:"),
    );
    expect(materialAudits).toHaveLength(1);
    await billing.projectSnapshot(paid, {
      checkoutAttemptId: checkout.attempt.attemptId,
    });
    expect(
      audit.records.filter((row) => row.effectId.startsWith("projection:")),
    ).toHaveLength(1);
    expect((await billing.commercialState(workspace.id)).projectionVersion).toBe(1);
  });

  it("telemetry failure cannot change a workflow result", async () => {
    const { billing, authorization, telemetry, now } = createWorkflowHarness();
    telemetry.failNext = true;
    const workspace = entity("ws_1");
    const actor = payer();
    const token = grant("checkout", workspace.id, actor.id, now);
    authorization.issue(token);
    const result = await billing.startCheckout({
      grant: token,
      entity: workspace,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
    });
    expect(result.attempt.status).toBe("open");
  });

  it("cloud composition without audit is an error", async () => {
    const { fake, store, authorization, clock } = createWorkflowHarness();
    const { createBilling } = await import("../workflows/engine.js");
    expect(() =>
      createBilling({
        database: store,
        providers: [fake],
        clock,
        authorization,
        mode: "cloud",
        checkoutProvider: "fake",
        requestedRevision: 1,
        requiredOfferKeys: ["pro_month"],
        offers: [REFERENCE_OFFERS[0]!],
      }),
    ).toThrow(/audit_hook_required/);
  });
});
