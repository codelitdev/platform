import { describe, expect, it } from "bun:test";
import { loadPresetManifest, validateResolvedVersions } from "./preset.js";

describe("platform preset", () => {
  it("ships schemaVersion 1 with recommended/supported/minimumSecure", () => {
    const manifest = loadPresetManifest();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.runtime.bun).toBe("1.4.1");
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

  it("checks exact external compatibility pins", () => {
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
  });
});
