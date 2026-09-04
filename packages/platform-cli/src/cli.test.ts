import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProduct } from "./create.js";
import { doctor } from "./doctor.js";
import { upgradeProduct } from "./upgrade.js";
import { applyReadmeTitleCodemod } from "./codemod-readme-title.js";
import { readManifest } from "./manifest.js";
import { sha256File } from "./hash.js";

function git(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

describe("platform-cli", () => {
  it("creates into an empty directory with metadata and product-owned paths", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "cli-create-"));
    const target = path.join(parent, "acme");
    const result = createProduct({
      targetDir: target,
      productName: "Acme",
    });
    expect(result.root).toBe(target);
    const manifest = readManifest(target);
    expect(manifest.capabilities).toContain("mcp");
    expect(manifest.productOwnedGlobs).toEqual([
      "apps/**",
      "packages/api-contract/**",
    ]);
    expect(manifest.managedFiles["tooling/platform/config.ts"]).toBe(
      sha256File(path.join(target, "tooling/platform/config.ts")),
    );
    const report = doctor(target);
    expect(report.issues).not.toContain("platform_manifest_invalid");
  });

  it("refuses upgrade on a dirty worktree and dry-run stays read-only", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "cli-git-"));
    const target = path.join(parent, "acme");
    createProduct({ targetDir: target, productName: "Acme" });
    git(target, ["init"]);
    git(target, ["config", "user.email", "test@example.com"]);
    git(target, ["config", "user.name", "Test"]);
    git(target, ["add", "."]);
    git(target, ["commit", "-m", "init"]);
    writeFileSync(path.join(target, "dirty.txt"), "x");
    expect(() => upgradeProduct({ root: target })).toThrow(
      "upgrade_requires_clean_worktree",
    );
    const dry = upgradeProduct({
      root: target,
      dryRun: true,
      allowDirty: true,
    });
    expect(dry.dryRun).toBe(true);
    expect(doctor(target).issues).not.toContain("platform_manifest_invalid");
  });

  it("treats managed hash mismatch as conflict", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "cli-conflict-"));
    const target = path.join(parent, "acme");
    createProduct({ targetDir: target, productName: "Acme" });
    writeFileSync(
      path.join(target, "tooling/platform/config.ts"),
      "export const drifted = true;\n",
    );
    const result = upgradeProduct({
      root: target,
      dryRun: true,
      allowDirty: true,
    });
    expect(result.conflicts).toContain("tooling/platform/config.ts");
  });

  it("does not apply codemods or record upgrades when any managed file conflicts", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "cli-conflict-write-"));
    const target = path.join(parent, "acme");
    createProduct({ targetDir: target, productName: "Acme" });
    writeFileSync(
      path.join(target, "tooling/platform/config.ts"),
      "export const drifted = true;\n",
    );
    const beforeReadme = readFileSync(
      path.join(target, "apps/api/README.md"),
      "utf8",
    );
    const beforeManifest = readManifest(target);
    const result = upgradeProduct({ root: target, allowDirty: true });
    expect(result.conflicts).toContain("tooling/platform/config.ts");
    expect(result.changed).toEqual([]);
    expect(readFileSync(path.join(target, "apps/api/README.md"), "utf8")).toBe(
      beforeReadme,
    );
    expect(readManifest(target)).toEqual(beforeManifest);
  });

  it("applies the readme title codemod idempotently and rolls back on failure", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "cli-codemod-"));
    const target = path.join(parent, "acme");
    createProduct({ targetDir: target, productName: "Acme" });
    const first = applyReadmeTitleCodemod(target, "acme");
    expect(first.changed).toBe(true);
    const second = applyReadmeTitleCodemod(target, "acme");
    expect(second.changed).toBe(false);
    git(target, ["init"]);
    git(target, ["config", "user.email", "test@example.com"]);
    git(target, ["config", "user.name", "Test"]);
    git(target, ["add", "."]);
    git(target, ["commit", "-m", "init"]);
    const before = readManifest(target);
    expect(() =>
      upgradeProduct({
        root: target,
        failAfterWrite: true,
      }),
    ).toThrow("upgrade_forced_failure; upgrade_rolled_back:");
    expect(readManifest(target)).toEqual(before);
  });

  it("updates only the managed TypeScript config with the requested version", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "cli-upgrade-version-"));
    const target = path.join(parent, "acme");
    createProduct({ targetDir: target, productName: "Acme" });
    const workflow = readFileSync(
      path.join(target, ".github/workflows/platform-conformance.yml"),
      "utf8",
    );
    const result = upgradeProduct({
      root: target,
      version: "1.2.0",
      allowDirty: true,
    });
    expect(result.changed).toContain("tooling/platform/config.ts");
    expect(
      readFileSync(path.join(target, "tooling/platform/config.ts"), "utf8"),
    ).toContain('platformTemplateVersion = "1.2.0"');
    expect(
      readFileSync(
        path.join(target, ".github/workflows/platform-conformance.yml"),
        "utf8",
      ),
    ).toBe(workflow);
    expect(
      upgradeProduct({ root: target, version: "1.2.0", allowDirty: true })
        .changed,
    ).toEqual([]);
  });

  it("fails doctor when a resolved @codelitdev package is below minimumSecure", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "cli-doctor-"));
    const target = path.join(parent, "acme");
    createProduct({ targetDir: target, productName: "Acme" });
    writeFileSync(
      path.join(target, "apps", "api", "package.json"),
      JSON.stringify(
        {
          name: "acme-api",
          dependencies: { "@codelitdev/platform": "0.0.1" },
        },
        null,
        2,
      ),
    );
    const report = doctor(target);
    expect(report.ok).toBe(false);
    expect(
      report.issues.some((issue) =>
        issue.includes("below_minimum_secure:@codelitdev/platform"),
      ),
    ).toBe(true);
  });

  it("uses pnpm lockfile resolutions when checking minimum secure versions", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "cli-doctor-lock-"));
    const target = path.join(parent, "acme");
    createProduct({ targetDir: target, productName: "Acme" });
    writeFileSync(
      path.join(target, "pnpm-lock.yaml"),
      [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "",
        "  apps/api:",
        "    dependencies:",
        "      '@codelitdev/platform':",
        "        specifier: 0.1.0-alpha.0",
        "        version: 0.0.1",
        "",
        "packages:",
      ].join("\n"),
    );
    const report = doctor(target);
    expect(report.ok).toBe(false);
    expect(report.issues).toContain(
      "below_minimum_secure:@codelitdev/platform",
    );
  });

  it("does not create into a non-empty directory", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cli-full-"));
    writeFileSync(path.join(dir, "keep.txt"), "1");
    expect(() =>
      createProduct({ targetDir: dir, productName: "Nope" }),
    ).toThrow("create_target_not_empty");
  });
});
