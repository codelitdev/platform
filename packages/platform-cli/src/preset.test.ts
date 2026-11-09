import { describe, expect, it } from "bun:test";
import { loadPresetManifest, validateResolvedVersions } from "./preset.js";

describe("platform preset", () => {
  it("ships schemaVersion 1 with recommended/supported/minimumSecure", () => {
    const manifest = loadPresetManifest();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.runtime.bun).toBe("1.4.4");
    const platform = manifest.packages["@codelitdev/platform"];
    expect(platform?.recommended).toBeTruthy();
    expect(platform?.supported).toContain(">=");
    expect(platform?.minimumSecure).toBeTruthy();
  });

  it("fails versions older than minimumSecure", () => {
    const issues = validateResolvedVersions({
      "@codelitdev/platform": "0.0.1",
    });
    expect(issues.some((issue) => issue.reason === "below_minimum_secure")).toBe(true);
    const ok = validateResolvedVersions({
      "@codelitdev/platform":
        loadPresetManifest().packages["@codelitdev/platform"]!.minimumSecure,
    });
    expect(ok).toEqual([]);
  });

  it("treats external pins as caret floors", () => {
    const manifest = loadPresetManifest();
    expect(
      validateResolvedVersions(
        {
          typescript: "5.9.2",
        },
        manifest,
      ).some((issue) => issue.reason === "external_mismatch"),
    ).toBe(true);
    expect(
      validateResolvedVersions({ typescript: manifest.external.typescript }, manifest),
    ).toEqual([]);
    const pinned = { ...manifest, external: { next: "16.4.1", pino: "0.5.2" } };
    const reasons = (resolved: Record<string, string>) =>
      validateResolvedVersions(resolved, pinned).map((issue) => issue.packageName);
    expect(reasons({ next: "16.4.1", pino: "0.5.2" })).toEqual([]);
    expect(reasons({ next: "16.4.5", pino: "0.5.9" })).toEqual([]);
    expect(reasons({ next: "16.5.0" })).toEqual([]);
    expect(reasons({ next: "16.3.6", pino: "0.5.1" })).toEqual(["next", "pino"]);
    expect(reasons({ next: "17.0.0", pino: "0.6.0" })).toEqual(["next", "pino"]);
  });
});
