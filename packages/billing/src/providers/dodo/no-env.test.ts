import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("dodo adapter construction", () => {
  it("does not read process.env and does not use sendlit metadata keys", async () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const source = await readFile(path.join(dir, "index.ts"), "utf8");
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/sendlit/i);
    expect(source).toMatch(/checkoutAttemptId/);
    const normalize = await readFile(path.join(dir, "normalize.ts"), "utf8");
    expect(normalize).not.toMatch(/sendlit/i);
  });
});
