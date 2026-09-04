import { defineBillingConfig } from "../../../src/config/index.js";

/**
 * CourseLit generates canonical billing_* tables with real foreign keys to
 * schools and payer accounts. Cloud Free never enters planIds or generated
 * checks; 14-day trials stay in CourseLit tables outside this schema.
 */
export default defineBillingConfig({
    dialect: "postgresql",
    adapter: "drizzle",
    output: "./src/db/schema/billing.generated.ts",
    billableEntity: {
        modelName: "school",
        tableImport: "./schools",
        tableExport: "schools",
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
});
