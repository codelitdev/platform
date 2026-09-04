import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("public exports", () => {
    it("exposes dist-only exports and no src/", async () => {
        const pkg = JSON.parse(
            await readFile(path.join(process.cwd(), "package.json"), "utf8"),
        ) as { exports: Record<string, unknown> };
        expect(JSON.stringify(pkg.exports)).not.toContain("src/");
        expect(pkg.exports["."]).toMatchObject({
            import: "./dist/index.js",
        });
    });
});
