import type { BillingConfig, CanonicalTableKey } from "../config/validate.js";
import { PACKAGE_SCHEMA_VERSION } from "../config/validate.js";

export const DEFAULT_TABLE_NAMES: Record<CanonicalTableKey, string> = {
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
};

export const CANONICAL_EXPORTS: Record<CanonicalTableKey, string> = {
    priceEntries: "billingPriceEntries",
    catalogRevisions: "billingCatalogRevisions",
    catalogRevisionItems: "billingCatalogRevisionItems",
    providerCustomers: "billingProviderCustomers",
    checkoutAttempts: "billingCheckoutAttempts",
    planChangeAttempts: "billingPlanChangeAttempts",
    subscriptions: "billingSubscriptions",
    planStates: "billingPlanStates",
    webhookEvents: "billingWebhookEvents",
    reconciliationJobs: "billingReconciliationJobs",
};

export function tableName(
    config: BillingConfig,
    key: CanonicalTableKey,
): string {
    const explicit = config.tableNames?.[key];
    if (explicit) return explicit;
    const prefix = config.tablePrefix ?? "billing_";
    const suffix = DEFAULT_TABLE_NAMES[key].slice("billing_".length);
    return `${prefix}${suffix}`;
}

export { PACKAGE_SCHEMA_VERSION };
