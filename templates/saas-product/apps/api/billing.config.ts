import { defineBillingConfig } from "@codelitdev/billing/config";

export default defineBillingConfig({
  dialect: "postgresql",
  adapter: "drizzle",
  output: "./src/db/schema/billing.generated.ts",
  billableEntity: {
    modelName: "tenant",
    tableImport: "./tenants",
    tableExport: "tenants",
    idColumn: "id",
    idType: "uuid",
    onDelete: "restrict",
  },
  payer: {
    modelName: "user",
    tableImport: "./auth.generated",
    tableExport: "user",
    idColumn: "id",
    idType: "text",
    onDelete: "restrict",
  },
  planIds: ["pro", "business"],
  requiredOfferKeys: ["pro_month", "pro_year", "business_month", "business_year"],
});
