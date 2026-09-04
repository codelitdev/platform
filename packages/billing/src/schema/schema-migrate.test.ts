import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
    boolean,
    pgTable,
    text,
    timestamp,
    uuid,
    integer,
} from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { frozenClock } from "../core/clock.js";
import { drizzleBillingAdapter } from "../adapters/drizzle/index.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CANONICAL_PGLITE_SQL } from "./pglite-sql.js";

const billingCheckoutAttempts = pgTable("billing_checkout_attempts", {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: text("attempt_id").notNull(),
    billableEntityId: uuid("billable_entity_id").notNull(),
    payerId: text("payer_id").notNull(),
    provider: text("provider").notNull(),
    catalogRevision: integer("catalog_revision").notNull(),
    offerKey: text("offer_key").notNull(),
    requestedPlan: text("requested_plan").notNull(),
    requestedInterval: text("requested_interval").notNull(),
    billingPriceEntryId: uuid("billing_price_entry_id").notNull(),
    quotedAmountMinor: integer("quoted_amount_minor").notNull(),
    quotedCurrency: text("quoted_currency").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

const billingWebhookEvents = pgTable("billing_webhook_events", {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
});

const billingProviderCustomers = pgTable("billing_provider_customers", {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    payerId: text("payer_id").notNull(),
    providerCustomerId: text("provider_customer_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
});

const billingSubscriptions = pgTable("billing_subscriptions", {
    id: uuid("id").primaryKey().defaultRandom(),
    billableEntityId: uuid("billable_entity_id").notNull(),
    billingCustomerId: uuid("billing_customer_id").notNull(),
    payerId: text("payer_id").notNull(),
    provider: text("provider").notNull(),
    providerSubscriptionId: text("provider_subscription_id").notNull(),
    providerProductId: text("provider_product_id").notNull(),
    billingPriceEntryId: uuid("billing_price_entry_id").notNull(),
    catalogRevision: integer("catalog_revision").notNull(),
    offerKey: text("offer_key").notNull(),
    plan: text("plan").notNull(),
    billingInterval: text("billing_interval").notNull(),
    status: text("status").notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull(),
    isEntitlementSource: boolean("is_entitlement_source").notNull(),
});

describe("empty database migrate + adapter round-trip", () => {
    it("applies canonical SQL and persists checkout/webhook through the drizzle adapter", async () => {
        const client = new PGlite();
        await client.exec(CANONICAL_PGLITE_SQL);
        const tables = await client.query<{ tablename: string }>(
            "select tablename from pg_tables where schemaname = 'public' order by tablename",
        );
        const names = tables.rows.map((row) => row.tablename);
        expect(names).toContain("billing_checkout_attempts");
        expect(names).toContain("billing_webhook_events");
        expect(names).toContain("billing_reconciliation_jobs");
        expect(names).toContain("billing_subscriptions");

        await client.query(
            "insert into accounts (id, email) values ('acct_1', 'a@example.com')",
        );
        const ws = await client.query<{ id: string }>(
            "insert into workspaces (name) values ('ws') returning id",
        );
        const price = await client.query<{ id: string }>(
            "insert into billing_price_entries (offer_key, plan, billing_interval, currency, amount_minor, provider, provider_product_id) values ('pro_month','pro','month','USD',4900,'fake','pdt_pro_month') returning id",
        );

        const db = drizzle(client, {
            schema: {
                billingCheckoutAttempts,
                billingWebhookEvents,
                billingProviderCustomers,
                billingSubscriptions,
            },
        });
        const adapter = drizzleBillingAdapter(db as never, {
            schema: {
                billingPriceEntries: {} as never,
                billingCatalogRevisions: {} as never,
                billingCatalogRevisionItems: {} as never,
                billingProviderCustomers: billingProviderCustomers as never,
                billingCheckoutAttempts: billingCheckoutAttempts as never,
                billingPlanChangeAttempts: {} as never,
                billingSubscriptions: billingSubscriptions as never,
                billingPlanStates: {} as never,
                billingWebhookEvents: billingWebhookEvents as never,
                billingReconciliationJobs: {} as never,
            },
            clock: frozenClock(new Date("2026-01-01T00:00:00.000Z")),
        });

        const inserted = (await adapter.insertCheckoutAttempt({
            attemptId: "bca_roundtrip",
            billableEntityId: ws.rows[0].id,
            payerId: "acct_1",
            provider: "fake",
            catalogRevision: 1,
            offerKey: "pro_month",
            requestedPlan: "pro",
            requestedInterval: "month",
            billingPriceEntryId: price.rows[0].id,
            quotedAmountMinor: 4900,
            quotedCurrency: "USD",
            idempotencyKey: "checkout:ws:pro_month:1",
            status: "creating",
            expiresAt: new Date("2026-01-01T01:00:00.000Z"),
        })) as Array<{ id: string; attemptId: string }>;
        const read = (await adapter.getCheckoutAttemptById(inserted[0].id)) as {
            attemptId: string;
        };
        expect(read.attemptId).toBe("bca_roundtrip");

        const events = (await adapter.insertWebhookEvent({
            provider: "fake",
            providerEventId: "evt_1",
            eventType: "subscription.updated",
            occurredAt: new Date("2026-01-01T00:00:00.000Z"),
            status: "pending",
        })) as Array<{ providerEventId: string }>;
        const event = (await adapter.getWebhookEvent("fake", "evt_1")) as {
            providerEventId: string;
        };
        expect(event.providerEventId).toBe("evt_1");
        expect(events[0].providerEventId).toBe("evt_1");

        const customers = (await adapter.insertProviderCustomer({
            provider: "fake",
            payerId: "acct_1",
            providerCustomerId: "cus_roundtrip",
            idempotencyKey: "customer:fake:acct_1",
            status: "active",
        })) as Array<{ id: string }>;
        const written = (await adapter.insertSubscriptionProjection({
            billableEntityId: ws.rows[0].id,
            billingCustomerId: customers[0].id,
            payerId: "acct_1",
            provider: "fake",
            providerSubscriptionId: "sub_roundtrip",
            providerProductId: "pdt_pro_month",
            billingPriceEntryId: price.rows[0].id,
            catalogRevision: 1,
            offerKey: "pro_month",
            plan: "pro",
            billingInterval: "month",
            status: "trialing",
            cancelAtPeriodEnd: false,
            isEntitlementSource: true,
        })) as Array<{ providerSubscriptionId: string; status: string }>;
        expect(written[0].providerSubscriptionId).toBe("sub_roundtrip");
        const projection = (await adapter.getSubscriptionProjection(
            "fake",
            "sub_roundtrip",
        )) as {
            status: string;
            offerKey: string;
            catalogRevision: number;
            providerProductId: string;
            isEntitlementSource: boolean;
            cancelAtPeriodEnd: boolean;
            payerId: string;
        };
        expect(projection.status).toBe("trialing");
        expect(projection.offerKey).toBe("pro_month");
        expect(projection.catalogRevision).toBe(1);
        expect(projection.providerProductId).toBe("pdt_pro_month");
        expect(projection.isEntitlementSource).toBe(true);
        expect(projection.cancelAtPeriodEnd).toBe(false);
        expect(projection.payerId).toBe("acct_1");
        void eq;
    });

    it("applies drizzle-kit generated SQL to an empty PGlite database", async () => {
        const sqlPath = path.join(
            process.cwd(),
            "examples/reference-product/apps/api/src/db/migrations/0000_billing_canonical.sql",
        );
        const sql = await readFile(sqlPath, "utf8");
        const client = new PGlite();
        for (const statement of sql.split("--> statement-breakpoint")) {
            const trimmed = statement.trim();
            if (trimmed) await client.exec(trimmed);
        }
        const tables = await client.query<{ tablename: string }>(
            "select tablename from pg_tables where schemaname = 'public'",
        );
        const names = tables.rows.map((row) => row.tablename);
        expect(names).toEqual(
            expect.arrayContaining([
                "billing_checkout_attempts",
                "billing_webhook_events",
                "billing_reconciliation_jobs",
                "billing_subscriptions",
                "billing_plan_states",
            ]),
        );
    });
});
