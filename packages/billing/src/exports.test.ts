import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("public exports", () => {
  it("exposes the architecture subpaths and no src/", async () => {
    const pkg = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as {
      exports: Record<string, { import: string; types: string }>;
      bin: Record<string, string>;
    };
    const expected = [
      "./core",
      "./catalog",
      "./config",
      "./drizzle",
      "./workflows",
      "./operations",
      "./providers",
      "./providers/dodo",
      "./testing",
    ];
    expect(Object.keys(pkg.exports).sort()).toEqual([...expected].sort());
    for (const key of expected) {
      expect(pkg.exports[key].import.startsWith("./dist/")).toBe(true);
      expect(pkg.exports[key].import).not.toContain("/src/");
    }
    expect(pkg.bin["codelit-billing"]).toBe("./bin/codelit-billing.js");
    expect(JSON.stringify(pkg.exports)).not.toContain("src/");
  });
});
