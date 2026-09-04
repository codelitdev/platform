import { defineBillingConfig } from "../../../../src/config/index.js";

export default defineBillingConfig({
  dialect: "postgresql",
  adapter: "drizzle",
  output: "./src/db/schema/billing.generated.ts",
  billableEntity: {
    modelName: "workspace",
    tableImport: "./workspaces",
    tableExport: "workspaces",
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
  requiredOfferKeys: ["pro_month", "pro_year", "business_month", "business_year"],
  additionalFields: {
    checkoutAttempts: {
      consumerReference: { type: "text" },
    },
  },
});
