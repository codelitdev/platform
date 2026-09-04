import { BillingConfigurationError } from "../core/errors.js";

export type IdType = "uuid" | "text";
export type OnDelete = "restrict" | "cascade" | "set null";

export type ExternalModelRef = {
  modelName: string;
  tableImport: string;
  tableExport: string;
  idColumn: string;
  idType: IdType;
  onDelete: OnDelete;
};

export type AdditionalFieldSpec = {
  type: "text" | "integer" | "boolean" | "timestamp";
  nullable?: boolean;
};

export type BillingConfig = {
  dialect: "postgresql";
  adapter: "drizzle";
  output: string;
  schemaVersion?: number;
  billableEntity: ExternalModelRef;
  payer: ExternalModelRef;
  planIds: string[];
  requiredOfferKeys?: string[];
  tablePrefix?: string;
  tableNames?: Partial<Record<CanonicalTableKey, string>>;
  additionalFields?: Partial<
    Record<CanonicalTableKey, Record<string, AdditionalFieldSpec>>
  >;
};

export const CANONICAL_TABLE_KEYS = [
  "priceEntries",
  "catalogRevisions",
  "catalogRevisionItems",
  "providerCustomers",
  "checkoutAttempts",
  "planChangeAttempts",
  "subscriptions",
  "planStates",
  "webhookEvents",
  "reconciliationJobs",
] as const;

export type CanonicalTableKey = (typeof CANONICAL_TABLE_KEYS)[number];

export const PACKAGE_SCHEMA_VERSION = 2;

const RESERVED_CANONICAL_FIELDS = new Set([
  "id",
  "offerKey",
  "plan",
  "billingInterval",
  "currency",
  "amountMinor",
  "provider",
  "providerProductId",
  "revision",
  "checkoutProvider",
  "status",
  "verifiedAt",
  "activatedAt",
  "retiredAt",
  "catalogRevisionId",
  "billingPriceEntryId",
  "payerId",
  "payerEmail",
  "providerCustomerId",
  "idempotencyKey",
  "lastError",
  "attemptId",
  "billableEntityId",
  "returnUrl",
  "catalogRevision",
  "requestedPlan",
  "requestedInterval",
  "quotedAmountMinor",
  "quotedCurrency",
  "billingCustomerId",
  "providerCheckoutSessionId",
  "checkoutUrlEncrypted",
  "expiresAt",
  "completedAt",
  "originCheckoutAttemptId",
  "providerSubscriptionId",
  "currentPeriodStartsAt",
  "currentPeriodEndsAt",
  "paidThroughAt",
  "trialEndsAt",
  "cancelAtPeriodEnd",
  "isEntitlementSource",
  "providerOccurredAt",
  "providerVersion",
  "lastObservedAt",
  "lastReconciledAt",
  "changeId",
  "subscriptionId",
  "actorId",
  "currentCatalogRevision",
  "currentBillingPriceEntryId",
  "currentPlan",
  "currentInterval",
  "targetCatalogRevision",
  "targetBillingPriceEntryId",
  "targetPlan",
  "targetInterval",
  "targetOfferKey",
  "effectiveAt",
  "prorationMode",
  "providerPaymentId",
  "paymentUrlEncrypted",
  "activeSubscriptionId",
  "projectionVersion",
  "eventType",
  "occurredAt",
  "checkoutAttemptId",
  "payloadEncrypted",
  "payloadKeyVersion",
  "verifiedKeyVersion",
  "processingAttempts",
  "availableAt",
  "lockedAt",
  "leaseExpiresAt",
  "workerId",
  "receivedAt",
  "operation",
  "createdAt",
  "updatedAt",
]);

const RESERVED_CANONICAL_COLUMNS = new Set(
  [...RESERVED_CANONICAL_FIELDS].map((name) =>
    name.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`),
  ),
);

export function validateBillingConfig(config: BillingConfig): BillingConfig {
  if (config.dialect !== "postgresql") {
    throw new BillingConfigurationError("dialect_must_be_postgresql");
  }
  if (config.adapter !== "drizzle") {
    throw new BillingConfigurationError("adapter_must_be_drizzle");
  }
  if (!config.output || config.output.includes("\0")) {
    throw new BillingConfigurationError("output_invalid");
  }
  if (
    config.schemaVersion !== undefined &&
    (!Number.isSafeInteger(config.schemaVersion) || config.schemaVersion <= 0)
  ) {
    throw new BillingConfigurationError("schema_version_invalid");
  }
  if (
    config.tablePrefix !== undefined &&
    config.tablePrefix !== "" &&
    !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(config.tablePrefix)
  ) {
    throw new BillingConfigurationError("table_prefix_invalid");
  }
  if (config.tableNames !== undefined) {
    if (
      !config.tableNames ||
      typeof config.tableNames !== "object" ||
      Array.isArray(config.tableNames)
    ) {
      throw new BillingConfigurationError("table_names_invalid");
    }
    for (const [key, value] of Object.entries(config.tableNames)) {
      if (!CANONICAL_TABLE_KEYS.includes(key as CanonicalTableKey)) {
        throw new BillingConfigurationError(`table_name_key_invalid:${key}`);
      }
      if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)) {
        throw new BillingConfigurationError(`table_name_invalid:${key}`);
      }
    }
  }
  const resolvedTableNames = new Set<string>();
  for (const key of CANONICAL_TABLE_KEYS) {
    const defaultName = `${config.tablePrefix ?? "billing_"}${key.replace(
      /[A-Z]/g,
      (character) => `_${character.toLowerCase()}`,
    )}`;
    const resolved = config.tableNames?.[key] ?? defaultName;
    if (resolvedTableNames.has(resolved)) {
      throw new BillingConfigurationError("table_names_must_be_unique");
    }
    resolvedTableNames.add(resolved);
  }
  if (!Array.isArray(config.planIds) || config.planIds.length === 0) {
    throw new BillingConfigurationError("plan_ids_required");
  }
  if (new Set(config.planIds).size !== config.planIds.length) {
    throw new BillingConfigurationError("plan_ids_must_be_unique");
  }
  for (const planId of config.planIds) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(planId)) {
      throw new BillingConfigurationError("plan_id_invalid");
    }
  }
  if (config.requiredOfferKeys !== undefined) {
    if (
      !Array.isArray(config.requiredOfferKeys) ||
      new Set(config.requiredOfferKeys).size !== config.requiredOfferKeys.length
    ) {
      throw new BillingConfigurationError("required_offer_keys_invalid");
    }
    for (const key of config.requiredOfferKeys) {
      if (typeof key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(key)) {
        throw new BillingConfigurationError("required_offer_key_invalid");
      }
    }
  }
  validateModel(config.billableEntity, "billableEntity");
  validateModel(config.payer, "payer");
  validateAdditionalFields(config.additionalFields);
  return config;
}

function validateAdditionalFields(fields: BillingConfig["additionalFields"]): void {
  if (fields === undefined) return;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new BillingConfigurationError("additional_fields_invalid");
  }
  for (const [table, tableFields] of Object.entries(fields)) {
    if (!CANONICAL_TABLE_KEYS.includes(table as CanonicalTableKey)) {
      throw new BillingConfigurationError(`additional_fields_table_invalid:${table}`);
    }
    if (!tableFields || typeof tableFields !== "object" || Array.isArray(tableFields)) {
      throw new BillingConfigurationError(`additional_fields_invalid:${table}`);
    }
    const seenColumns = new Set<string>();
    for (const [name, spec] of Object.entries(tableFields)) {
      const column = name.replace(
        /[A-Z]/g,
        (character) => `_${character.toLowerCase()}`,
      );
      if (seenColumns.has(column)) {
        throw new BillingConfigurationError(
          `additional_field_name_invalid:${table}.${name}`,
        );
      }
      seenColumns.add(column);
      if (
        !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ||
        (RESERVED_CANONICAL_FIELDS.has(name) &&
          !(table === "planStates" && name === "plan")) ||
        (RESERVED_CANONICAL_COLUMNS.has(column) &&
          !(table === "planStates" && column === "plan"))
      ) {
        throw new BillingConfigurationError(
          `additional_field_name_invalid:${table}.${name}`,
        );
      }
      if (
        !spec ||
        typeof spec !== "object" ||
        !["text", "integer", "boolean", "timestamp"].includes(
          (spec as { type?: unknown }).type as string,
        ) ||
        ((spec as { nullable?: unknown }).nullable !== undefined &&
          typeof (spec as { nullable?: unknown }).nullable !== "boolean")
      ) {
        throw new BillingConfigurationError(
          `additional_field_spec_invalid:${table}.${name}`,
        );
      }
    }
  }
}

function validateModel(model: ExternalModelRef, label: string): void {
  if (
    !model.modelName ||
    !model.tableImport ||
    !model.tableExport ||
    !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(model.tableExport) ||
    !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(model.idColumn) ||
    /[\0\r\n"']/.test(model.tableImport)
  ) {
    throw new BillingConfigurationError(`${label}_mapping_incomplete`);
  }
  if (model.idType !== "uuid" && model.idType !== "text") {
    throw new BillingConfigurationError(`${label}_id_type_invalid`);
  }
  if (!["restrict", "cascade", "set null"].includes(model.onDelete)) {
    throw new BillingConfigurationError(`${label}_on_delete_invalid`);
  }
}
