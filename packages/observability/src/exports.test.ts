import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("public exports", () => {
    it("exposes dist-only root export and no src/", async () => {
        const pkg = JSON.parse(
            await readFile(path.join(process.cwd(), "package.json"), "utf8"),
        ) as { exports: Record<string, { import: string }> };
        expect(Object.keys(pkg.exports)).toEqual([".", "./browser"]);
        expect(pkg.exports["."].import).toBe("./dist/index.js");
        expect(pkg.exports["./browser"].import).toBe("./dist/browser.js");
        expect(JSON.stringify(pkg.exports)).not.toContain("src/");
    });
});
