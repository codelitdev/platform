import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readdir } from "node:fs/promises";

const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");

async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await walk(full)));
        else if (
            entry.name.endsWith(".ts") &&
            !entry.name.endsWith(".test.ts")
        ) {
            files.push(full);
        }
    }
    return files;
}

describe("hexagonal isolation", () => {
    it("core does not import provider SDKs, Express, Drizzle, Pino, PostHog, or product modules", async () => {
        const files = await walk(path.join(root, "core"));
        const forbidden =
            /from ["'](dodopayments|drizzle-orm|express|pino|posthog-node|posthog)["']/;
        for (const file of files) {
            const source = await readFile(file, "utf8");
            expect(source, file).not.toMatch(forbidden);
            expect(source, file).not.toMatch(/sendlit|courselit/i);
        }
    });

    it("catalog and config stay ORM/SDK free", async () => {
        for (const dir of ["catalog", "config"]) {
            const files = await walk(path.join(root, dir));
            for (const file of files) {
                const source = await readFile(file, "utf8");
                expect(source, file).not.toMatch(
                    /from ["'](dodopayments|drizzle-orm|express|pino|posthog-node)["']/,
                );
            }
        }
    });
});
