import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as auth from "../../../examples/reference-product/apps/api/src/db/schema/auth.js";
import * as billingSchema from "../../../examples/reference-product/apps/api/src/db/schema/billing.generated.js";
import * as workspaces from "../../../examples/reference-product/apps/api/src/db/schema/workspaces.js";
import { frozenClock } from "../../core/clock.js";
import { MemoryAuditHook } from "../../ports/audit.js";
import { MemoryAuthorizationPort } from "../../ports/authorization.js";
import { FakeBillingProvider } from "../../providers/fake/index.js";
import {
  COURSELIT_OFFER_KEYS,
  entity,
  grant,
  payer,
  REFERENCE_OFFERS,
} from "../../testing/fixtures.js";
import { createBilling } from "../../workflows/engine.js";
import { drizzleBillingAdapter } from "./index.js";

describe("drizzle adapter", () => {
  it("constructor and import perform no DDL", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    const clock = frozenClock(new Date("2026-01-01T00:00:00.000Z"));
    const adapter = drizzleBillingAdapter(db as never, {
      schema: {
        billingPriceEntries: {} as never,
        billingCatalogRevisions: {} as never,
        billingCatalogRevisionItems: {} as never,
        billingProviderCustomers: {} as never,
        billingCheckoutAttempts: {} as never,
        billingPlanChangeAttempts: {} as never,
        billingSubscriptions: {} as never,
        billingPlanStates: {} as never,
        billingWebhookEvents: {} as never,
        billingReconciliationJobs: {} as never,
      },
      clock,
    });
    expect(adapter.transactionDepth).toBe(0);
    const tables = await client.query(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    expect(tables.rows).toEqual([]);
    void workspaces;
    void auth;
  });

  it("runs checkout and webhook projection through the drizzle store", async () => {
    const client = new PGlite();
    const migrationDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../examples/reference-product/apps/api/src/db/migrations",
    );
    for (const migration of [
      "0000_billing_canonical.sql",
      "0001_greedy_tiger_shark.sql",
      "0002_cool_tenebrous.sql",
      "0003_magical_mister_sinister.sql",
      "0004_bright_firelord.sql",
      "0005_nebulous_arclight.sql",
      "0006_acoustic_iron_lad.sql",
    ]) {
      const sql = readFileSync(path.join(migrationDir, migration), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed) await client.exec(trimmed);
      }
    }
    const db = drizzle(client, {
      schema: { ...workspaces, ...auth, ...billingSchema },
    });
    const now = new Date("2026-01-01T00:00:00.000Z");
    const clock = frozenClock(now);
    await db.insert(auth.accounts).values({
      id: "acct_payer",
      email: "payer@example.com",
    });
    const workspaceId = "11111111-1111-1111-1111-111111111111";
    await db.insert(workspaces.workspaces).values({
      id: workspaceId,
      name: "Workspace",
    });
    const fake = new FakeBillingProvider({ clock });
    fake.seedDefaultCatalog();
    const authorization = new MemoryAuthorizationPort();
    const audit = new MemoryAuditHook();
    const store = drizzleBillingAdapter(db as never, {
      schema: billingSchema,
      clock,
      checkoutApplicationFields: {
        toColumns: (fields) => ({
          consumerReference: fields.consumerReference,
        }),
        fromRow: (row) => ({
          consumerReference: row.consumerReference,
        }),
      },
    });
    const billing = createBilling({
      database: store,
      providers: [fake],
      clock,
      authorization,
      hooks: { audit },
      mode: "cloud",
      checkoutProvider: "fake",
      requestedRevision: 1,
      requiredOfferKeys: [...COURSELIT_OFFER_KEYS],
      offers: REFERENCE_OFFERS,
      returnUrlValidator: (url) => url.startsWith("https://app.test/"),
    });
    const workspace = entity(workspaceId);
    await expect(billing.verifyRequestedCatalog()).resolves.toEqual({
      verified: true,
      revision: 1,
      mismatches: [],
    });
    const actor = payer();
    // Switching from yearly to monthly replaces the open yearly checkout.
    const yearlyToken = {
      ...grant("checkout", workspaceId, actor.id, now),
      grantId: "grant_drizzle_yearly",
    };
    authorization.issue(yearlyToken);
    const yearly = await billing.startCheckout({
      grant: yearlyToken,
      entity: workspace,
      payer: actor,
      offerKey: "pro_year",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
      applicationFields: { consumerReference: "school:primary" },
    });
    const token = grant("checkout", workspaceId, actor.id, now);
    authorization.issue(token);
    const checkout = await billing.startCheckout({
      grant: token,
      entity: workspace,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
      applicationFields: { consumerReference: "school:primary" },
    });
    expect(checkout.attempt.status).toBe("open");
    await expect(store.findCheckoutById(yearly.attempt.id)).resolves.toMatchObject({
      status: "abandoned",
    });
    await expect(store.findCheckoutById(checkout.attempt.id)).resolves.toMatchObject({
      applicationFields: { consumerReference: "school:primary" },
    });
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
    await billing.runWebhookInboxBatch({ workerId: "wh-pg" });
    const state = await billing.commercialState(workspaceId);
    expect(state.activePaidPlan).toBe("pro");
    expect(state.projectionVersion).toBe(1);
    expect(state.pendingCheckout).toBe(false);

    // Reads inside the caller's transaction see the same state.
    const inTransaction = await db.transaction((tx) =>
      billing.commercialState(workspaceId, { transaction: tx }),
    );
    expect(inTransaction.activePaidPlan).toBe("pro");

    // Discovery finds the subscription that was never reconciled.
    await billing.runReconciliationBatch({ workerId: "rc-pg" });
    const [reconciled] = await db.select().from(billingSchema.billingSubscriptions);
    expect(reconciled?.lastReconciledAt).toBeInstanceOf(Date);
  });

  it("expires checkouts and purges retained secrets through drizzle", async () => {
    const client = new PGlite();
    const migrationDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../examples/reference-product/apps/api/src/db/migrations",
    );
    for (const migration of [
      "0000_billing_canonical.sql",
      "0001_greedy_tiger_shark.sql",
      "0002_cool_tenebrous.sql",
      "0003_magical_mister_sinister.sql",
      "0004_bright_firelord.sql",
      "0005_nebulous_arclight.sql",
      "0006_acoustic_iron_lad.sql",
    ]) {
      const sql = readFileSync(path.join(migrationDir, migration), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed) await client.exec(trimmed);
      }
    }
    const db = drizzle(client, {
      schema: { ...workspaces, ...auth, ...billingSchema },
    });
    const now = new Date("2026-01-01T00:00:00.000Z");
    const clock = frozenClock(now);
    await db.insert(auth.accounts).values({
      id: "acct_payer",
      email: "payer@example.com",
    });
    const workspaceId = "22222222-2222-2222-2222-222222222222";
    await db.insert(workspaces.workspaces).values({
      id: workspaceId,
      name: "Deadline",
    });
    const fake = new FakeBillingProvider({ clock });
    fake.seedDefaultCatalog();
    const authorization = new MemoryAuthorizationPort();
    const audit = new MemoryAuditHook();
    const store = drizzleBillingAdapter(db as never, {
      schema: billingSchema,
      clock,
      checkoutApplicationFields: {
        toColumns: (fields) => ({
          consumerReference: fields.consumerReference,
        }),
        fromRow: (row) => ({
          consumerReference: row.consumerReference,
        }),
      },
    });
    const billing = createBilling({
      database: store,
      providers: [fake],
      clock,
      authorization,
      hooks: { audit },
      mode: "cloud",
      checkoutProvider: "fake",
      requestedRevision: 1,
      requiredOfferKeys: [...COURSELIT_OFFER_KEYS],
      offers: REFERENCE_OFFERS,
      returnUrlValidator: (url) => url.startsWith("https://app.test/"),
    });
    await billing.verifyRequestedCatalog();
    const workspace = entity(workspaceId);
    const actor = payer();
    const token = grant("checkout", workspaceId, actor.id, now);
    authorization.issue(token);
    const checkout = await billing.startCheckout({
      grant: token,
      entity: workspace,
      payer: actor,
      offerKey: "pro_month",
      catalogRevision: 1,
      returnUrl: "https://app.test/billing",
      applicationFields: { consumerReference: "school:deadline" },
    });
    checkout.attempt.expiresAt = new Date(now.getTime() - 1);
    await store.saveCheckout(checkout.attempt);
    await expect(billing.runDeadlineBatch()).resolves.toBe(1);
    await expect(store.findCheckoutById(checkout.attempt.id)).resolves.toMatchObject({
      status: "expired",
      checkoutUrlEncrypted: null,
      applicationFields: { consumerReference: "school:deadline" },
    });

    const expired = await store.findCheckoutById(checkout.attempt.id);
    expired!.checkoutUrlEncrypted = "enc:checkout";
    expired!.completedAt = new Date(now.getTime() - 2_000);
    await store.saveCheckout(expired!);
    await expect(
      billing.purgeExpiredSensitiveValues({
        before: new Date(now.getTime() - 1_000),
      }),
    ).resolves.toEqual({
      checkoutUrls: 1,
      planChangeUrls: 0,
      webhookPayloads: 0,
    });
    await expect(store.findCheckoutById(checkout.attempt.id)).resolves.toMatchObject({
      checkoutUrlEncrypted: null,
      applicationFields: { consumerReference: "school:deadline" },
    });
  });
});
