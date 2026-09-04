import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("public exports", () => {
  it("exposes dist-only root export and bin", async () => {
    const pkg = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as {
      exports: Record<string, { import: string }>;
      bin: Record<string, string>;
    };
    expect(pkg.exports["."].import).toBe("./dist/index.js");
    expect(pkg.bin["codelit-platform"]).toBe("./dist/bin.js");
    expect(JSON.stringify(pkg.exports)).not.toContain("src/");
  });
});
