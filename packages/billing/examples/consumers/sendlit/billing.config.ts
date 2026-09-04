import { defineBillingConfig } from "../../../src/config/index.js";

/**
 * SendLit maps billing onto existing organization/account tables and keeps
 * the current billing_* table names so generation does not invent a parallel
 * organisation-named billing schema. Free-plan, ramp, and negotiated limits
 * remain application columns on plan state.
 */
export default defineBillingConfig({
    dialect: "postgresql",
    adapter: "drizzle",
    output: "./src/db/schema/billing.generated.ts",
    billableEntity: {
        modelName: "organization",
        tableImport: "./organizations",
        tableExport: "organizations",
        idColumn: "id",
        idType: "uuid",
        onDelete: "restrict",
    },
    payer: {
        modelName: "account",
        tableImport: "./auth",
        tableExport: "accounts",
        idColumn: "id",
        idType: "text",
        onDelete: "restrict",
    },
    planIds: ["pro", "business"],
    requiredOfferKeys: [
        "pro_month",
        "pro_year",
        "business_month",
        "business_year",
    ],
    tableNames: {
        priceEntries: "billing_price_entries",
        catalogRevisions: "billing_catalog_revisions",
        catalogRevisionItems: "billing_catalog_revision_items",
        providerCustomers: "billing_provider_customers",
        checkoutAttempts: "billing_checkout_attempts",
        planChangeAttempts: "billing_plan_change_attempts",
        subscriptions: "billing_subscriptions",
        planStates: "billing_plan_states",
        webhookEvents: "billing_webhook_events",
        reconciliationJobs: "billing_reconciliation_jobs",
    },
    additionalFields: {
        planStates: {
            plan: { type: "text", nullable: true },
            rampStage: { type: "integer", nullable: true },
            pendingTeamName: { type: "text", nullable: true },
            teamLimitOverride: { type: "integer", nullable: true },
            contactLimitOverride: { type: "integer", nullable: true },
        },
    },
});
