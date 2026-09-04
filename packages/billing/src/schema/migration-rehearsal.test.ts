import { execFileSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import courselitConfig from "../../examples/consumers/courselit/billing.config.js";
import sendlitConfig from "../../examples/consumers/sendlit/billing.config.js";
import { renderGeneratedSchema } from "./generator.js";

const CANONICAL_TABLES = [
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
] as const;

function writeConsumerApp(input: {
    entityFile: string;
    entitySource: string;
    generated: string;
}) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "billing-rehearsal-"));
    const schemaDir = path.join(dir, "src/db/schema");
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(
        path.join(schemaDir, "auth.ts"),
        `import { pgTable, text } from "drizzle-orm/pg-core";
export const accounts = pgTable("accounts", {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
});
`,
    );
    writeFileSync(path.join(schemaDir, input.entityFile), input.entitySource);
    writeFileSync(
        path.join(schemaDir, "billing.generated.ts"),
        input.generated,
    );
    symlinkSync(
        path.join(process.cwd(), "node_modules"),
        path.join(dir, "node_modules"),
        "dir",
    );
    writeFileSync(
        path.join(dir, "drizzle.config.ts"),
        `import path from "node:path";
import { defineConfig } from "drizzle-kit";
const root = ${JSON.stringify(dir)};
export default defineConfig({
    schema: [
        path.join(root, "src/db/schema/auth.ts"),
        path.join(root, "src/db/schema/${input.entityFile}"),
        path.join(root, "src/db/schema/billing.generated.ts"),
    ],
    out: path.join(root, "drizzle"),
    dialect: "postgresql",
});
`,
    );
    execFileSync(
        "pnpm",
        [
            "exec",
            "drizzle-kit",
            "generate",
            "--name",
            "consumer_billing",
            "--config",
            path.join(dir, "drizzle.config.ts"),
        ],
        { cwd: process.cwd(), stdio: "pipe" },
    );
    return dir;
}

async function applyRehearsalSql(dir: string) {
    const journal = JSON.parse(
        readFileSync(path.join(dir, "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    const tag = journal.entries.at(-1)?.tag;
    if (!tag) throw new Error("drizzle_journal_empty");
    const sql = readFileSync(path.join(dir, "drizzle", `${tag}.sql`), "utf8");
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/\bfree\b/i);
    for (const table of CANONICAL_TABLES) {
        expect(sql).toContain(table);
    }
    const client = new PGlite();
    for (const statement of sql.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed) await client.exec(trimmed);
    }
    const tables = await client.query<{ tablename: string }>(
        "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    return { sql, names: tables.rows.map((row) => row.tablename) };
}

describe("consumer migration rehearsal", () => {
    it("generates and applies a CourseLit schools mapping without parallel tables", async () => {
        const generated = renderGeneratedSchema(courselitConfig);
        const dir = writeConsumerApp({
            entityFile: "schools.ts",
            entitySource: `import { pgTable, text, uuid } from "drizzle-orm/pg-core";
export const schools = pgTable("schools", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
});
`,
            generated,
        });
        const { sql, names } = await applyRehearsalSql(dir);
        expect(sql).toMatch(/"schools"/);
        expect(sql).not.toContain("school_subscriptions");
        expect(names).toEqual(
            expect.arrayContaining([
                "schools",
                "accounts",
                ...CANONICAL_TABLES,
            ]),
        );
        expect(names).toContain("schools");
        expect(names.filter((name) => name.startsWith("school_"))).toEqual([]);
    });

    it("maps SendLit onto existing billing_* names without organisation-named billing tables", async () => {
        const generated = renderGeneratedSchema(sendlitConfig);
        const dir = writeConsumerApp({
            entityFile: "organizations.ts",
            entitySource: `import { pgTable, text, uuid } from "drizzle-orm/pg-core";
export const organizations = pgTable("organizations", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
});
`,
            generated,
        });
        const { sql, names } = await applyRehearsalSql(dir);
        expect(sql).toMatch(/"organizations"/);
        expect(sql).toContain("ramp_stage");
        expect(sql).toContain("pending_team_name");
        expect(sql).not.toContain("organization_subscriptions");
        expect(names).toEqual(
            expect.arrayContaining([
                "organizations",
                "accounts",
                ...CANONICAL_TABLES,
            ]),
        );
        expect(
            names.filter((name) => name.startsWith("organization_")),
        ).toEqual([]);
    });
});
