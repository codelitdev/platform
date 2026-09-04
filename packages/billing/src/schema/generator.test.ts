import { describe, expect, it } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defineBillingConfig } from "../config/index.js";
import { PACKAGE_SCHEMA_VERSION } from "../config/validate.js";
import { renderGeneratedSchema } from "./generator.js";

const config = defineBillingConfig({
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
});

describe("schema generator", () => {
  it("emits a warning header, schema version, models, and uniqueness", () => {
    const source = renderGeneratedSchema(config);
    expect(source).toContain("AUTO-GENERATED FILE. DO NOT EDIT.");
    expect(source).toContain(`schema version ${PACKAGE_SCHEMA_VERSION}`);
    for (const table of [
      "billing_price_entries",
      "billing_catalog_revisions",
      "billing_catalog_revision_items",
      "billing_provider_customers",
      "billing_checkout_attempts",
      "billing_plan_change_attempts",
      "billing_subscriptions",
      "billing_plan_states",
      "billing_webhook_events",
      "billing_reconciliation_jobs",
    ]) {
      expect(source).toContain(`"${table}"`);
    }
    expect(source).toContain("billing_provider_customers_provider_payer_uidx");
    expect(source).toContain("billing_subscriptions_provider_subscription_uidx");
    expect(source).toContain("billing_subscriptions_entity_source_uidx");
    expect(source).toContain("billing_checkout_attempts_idempotency_uidx");
    expect(source).toContain("billing_checkout_attempts_entity_nonterminal_uidx");
    expect(source).toContain("billing_plan_change_attempts_idempotency_uidx");
    expect(source).toContain("billing_webhook_events_provider_event_uidx");
    expect(source).toContain("billing_reconciliation_jobs_exactly_one_subject");
    expect(source).toContain("billing_reconciliation_jobs_live_checkout_uidx");
    expect(source).not.toContain("organization_");
    expect(source).not.toContain("school_");
    expect(renderGeneratedSchema(config)).toBe(source);
  });

  it("treats additionalFields as opaque extra columns", () => {
    const source = renderGeneratedSchema({
      ...config,
      additionalFields: {
        planStates: { rampStage: { type: "integer", nullable: true } },
      },
    });
    expect(source).toContain("rampStage");
    expect(source).not.toMatch(/rampStage.*free/);
  });

  it("applies a validated table prefix", () => {
    const source = renderGeneratedSchema({
      ...config,
      tablePrefix: "custom_",
    });
    expect(source).toContain('"custom_price_entries"');
    expect(source).not.toContain('"billing_price_entries"');
  });

  it("rejects extensions that can override canonical columns", () => {
    expect(() =>
      defineBillingConfig({
        ...config,
        additionalFields: {
          priceEntries: { provider: { type: "text" } },
        },
      }),
    ).toThrow(/additional_field_name_invalid/);
  });
});

describe("generate --check", () => {
  it("fails when committed output drifted", async () => {
    const dir = path.join(os.tmpdir(), `billing-gen-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const configPath = path.join(dir, "billing.config.js");
    const output = path.join(dir, "billing.generated.ts");
    await writeFile(
      configPath,
      `export default ${JSON.stringify({ ...config, output: "./billing.generated.ts" })};\n`,
    );
    const { runGenerate } = await import("../cli/generate.js");
    await runGenerate({ configPath, cwd: dir });
    const first = await readFile(output, "utf8");
    await runGenerate({ configPath, cwd: dir });
    const second = await readFile(output, "utf8");
    expect(second).toBe(first);
    await runGenerate({ configPath, check: true, cwd: dir });
    await writeFile(output, `${first}\n`);
    await expect(runGenerate({ configPath, check: true, cwd: dir })).rejects.toThrow(
      /billing_schema_drift/,
    );
  });
});
