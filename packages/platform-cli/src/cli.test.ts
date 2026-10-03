import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createProduct } from "./create.js";
import { doctor } from "./doctor.js";
import { sha256File } from "./hash.js";
import { readManifest, writeManifest } from "./manifest.js";
import { syncProduct } from "./sync.js";
import { cliVersion, productNameFromTarget } from "./template.js";

function git(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function createCommitted(prefix: string): string {
  const target = path.join(mkdtempSync(path.join(tmpdir(), prefix)), "acme");
  createProduct({ targetDir: target, productName: "Acme" });
  git(target, ["init"]);
  git(target, ["config", "user.email", "test@example.com"]);
  git(target, ["config", "user.name", "Test"]);
  git(target, ["add", "."]);
  git(target, ["commit", "-m", "init"]);
  return target;
}

const WORKFLOW = ".github/workflows/platform-conformance.yml";

describe("platform-cli", () => {
  it("derives the product name from the target directory basename", () => {
    expect(productNameFromTarget("/tmp/acme-school")).toBe("acme-school");
    expect(productNameFromTarget("nested/My School")).toBe("My School");
  });

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
    expect(manifest.productOwnedGlobs).toEqual(["apps/**", "packages/api-contract/**"]);
    expect(manifest.managedFiles[".github/workflows/platform-conformance.yml"]).toBe(
      sha256File(path.join(target, ".github/workflows/platform-conformance.yml")),
    );
    const webTsconfig = JSON.parse(
      readFileSync(path.join(target, "apps/web/tsconfig.json"), "utf8"),
    ) as { include?: string[] };
    expect(webTsconfig.include).toContain(".next/types/**/*.ts");
    expect(readFileSync(path.join(target, "apps/web/next-env.d.ts"), "utf8")).toContain(
      'reference path="./.next/types/routes.d.ts"',
    );
    const report = doctor(target);
    expect(report.issues).not.toContain("platform_manifest_invalid");
  });

  it("records product tokens and the CLI version in a v2 manifest", () => {
    const target = path.join(mkdtempSync(path.join(tmpdir(), "cli-manifest-")), "acme");
    createProduct({ targetDir: target, productName: "Acme" });
    const manifest = readManifest(target);
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.product).toEqual({ name: "Acme", slug: "acme" });
    expect(manifest.cliVersion).toBe(cliVersion());
    expect(Object.keys(manifest.managedFiles)).not.toContain(
      ".github/workflows/code-quality.yml",
    );
  });

  it("generates a managed conformance workflow and a product-owned quality workflow", () => {
    const target = path.join(mkdtempSync(path.join(tmpdir(), "cli-workflow-")), "acme");
    createProduct({ targetDir: target, productName: "Acme" });
    const conformance = readFileSync(path.join(target, WORKFLOW), "utf8");
    expect(conformance).toContain(
      `bunx @codelitdev/platform-cli@${cliVersion()} doctor`,
    );
    expect(conformance).toContain('bun run --filter "*/api" test:conformance');
    expect(conformance).not.toContain("bun run build");
    const quality = readFileSync(
      path.join(target, ".github/workflows/code-quality.yml"),
      "utf8",
    );
    expect(quality).toContain("bun run lint");
    expect(quality).toContain("bun run build");
    expect(readFileSync(path.join(target, ".github/dependabot.yml"), "utf8")).toContain(
      '"@codelitdev/*"',
    );
    const api = JSON.parse(
      readFileSync(path.join(target, "apps/api/package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(api.scripts["test:conformance"]).toBeDefined();
  });

  it("refuses sync on a dirty worktree and dry-run stays read-only", () => {
    const target = createCommitted("cli-git-");
    writeFileSync(path.join(target, "dirty.txt"), "x");
    expect(() => syncProduct({ root: target })).toThrow("sync_requires_clean_worktree");
    const before = readFileSync(path.join(target, ".codelit-platform.json"), "utf8");
    const dry = syncProduct({ root: target, dryRun: true });
    expect(dry).toEqual({ dryRun: true, changed: [], conflicts: [], released: [] });
    expect(readFileSync(path.join(target, ".codelit-platform.json"), "utf8")).toBe(
      before,
    );
  });

  it("rewrites an unchanged managed file from the current template", () => {
    const target = createCommitted("cli-sync-");
    const file = path.join(target, WORKFLOW);
    const current = readFileSync(file, "utf8");
    const stale = current.replace(`platform-cli@${cliVersion()}`, "platform-cli@0.0.1");
    writeFileSync(file, stale);
    const manifest = readManifest(target);
    manifest.managedFiles[WORKFLOW] = sha256File(file);
    writeManifest(target, manifest);
    git(target, ["commit", "-am", "older cli"]);

    expect(syncProduct({ root: target, dryRun: true }).changed).toEqual([WORKFLOW]);
    expect(readFileSync(file, "utf8")).toBe(stale);
    expect(syncProduct({ root: target }).changed).toEqual([WORKFLOW]);
    expect(readFileSync(file, "utf8")).toBe(current);
    expect(readManifest(target).managedFiles[WORKFLOW]).toBe(sha256File(file));
    expect(doctor(target).issues.filter((i) => i.startsWith("managed_"))).toEqual([]);
    expect(syncProduct({ root: target, allowDirty: true }).changed).toEqual([]);
  });

  it("treats managed drift as a conflict and writes nothing", () => {
    const target = createCommitted("cli-conflict-");
    const drifted = "name: edited by the product\n";
    writeFileSync(path.join(target, WORKFLOW), drifted);
    const manifestBefore = readManifest(target);
    const result = syncProduct({ root: target, allowDirty: true });
    expect(result.conflicts).toEqual([WORKFLOW]);
    expect(result.changed).toEqual([]);
    expect(readFileSync(path.join(target, WORKFLOW), "utf8")).toBe(drifted);
    expect(readManifest(target)).toEqual(manifestBefore);
  });

  it("adopts a missing managed file but not a different existing one", () => {
    const target = createCommitted("cli-adopt-");
    const manifest = readManifest(target);
    delete manifest.managedFiles[WORKFLOW];
    writeManifest(target, manifest);
    rmSync(path.join(target, WORKFLOW));
    expect(syncProduct({ root: target, allowDirty: true }).changed).toEqual([WORKFLOW]);
    expect(existsSync(path.join(target, WORKFLOW))).toBe(true);

    const again = readManifest(target);
    delete again.managedFiles[WORKFLOW];
    writeManifest(target, again);
    writeFileSync(path.join(target, WORKFLOW), "name: product workflow\n");
    expect(syncProduct({ root: target, allowDirty: true }).conflicts).toEqual([
      WORKFLOW,
    ]);
  });

  it("restores files and the manifest when a sync fails mid-write", () => {
    const target = createCommitted("cli-rollback-");
    rmSync(path.join(target, WORKFLOW));
    git(target, ["commit", "-am", "drop workflow"]);
    const manifest = readManifest(target);
    delete manifest.managedFiles[WORKFLOW];
    writeManifest(target, manifest);
    git(target, ["commit", "-am", "unmanage workflow"]);
    const before = readFileSync(path.join(target, ".codelit-platform.json"), "utf8");
    expect(() => syncProduct({ root: target, failAfterWrite: true })).toThrow(
      "sync_forced_failure; sync_rolled_back:",
    );
    expect(existsSync(path.join(target, WORKFLOW))).toBe(false);
    expect(readFileSync(path.join(target, ".codelit-platform.json"), "utf8")).toBe(
      before,
    );
  });

  it("migrates a v1 manifest on sync", () => {
    const target = createCommitted("cli-v1-");
    const v2 = readManifest(target);
    writeFileSync(
      path.join(target, ".codelit-platform.json"),
      JSON.stringify({
        schemaVersion: 1,
        templateVersion: "1.0.0",
        presetVersion: "0.1.0-alpha.1",
        capabilities: v2.capabilities,
        managedFiles: { ...v2.managedFiles, "legacy/managed.txt": "0".repeat(64) },
        productOwnedGlobs: v2.productOwnedGlobs,
        appliedUpgrades: ["1.0.0"],
      }),
    );
    const result = syncProduct({ root: target, allowDirty: true });
    expect(result.released).toEqual(["legacy/managed.txt"]);
    const migrated = JSON.parse(
      readFileSync(path.join(target, ".codelit-platform.json"), "utf8"),
    );
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.product).toEqual({ name: "acme", slug: "acme" });
    expect(migrated.templateVersion).toBeUndefined();
    expect(migrated.presetVersion).toBeUndefined();
    expect(Object.keys(migrated.managedFiles)).not.toContain("legacy/managed.txt");
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

  it("uses Bun lockfile resolutions when checking minimum secure versions", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "cli-doctor-lock-"));
    const target = path.join(parent, "acme");
    createProduct({ targetDir: target, productName: "Acme" });
    writeFileSync(
      path.join(target, "bun.lock"),
      [
        "{",
        '  "lockfileVersion": 2,',
        '  "configVersion": 1,',
        "",
        '  "workspaces": {',
        "",
        '    "": {},',
        "",
        "  },",
        '  "packages": {',
        '    "@codelitdev/platform": ["@codelitdev/platform@0.0.1", "", {}, ""],',
        "  }",
        "}",
      ].join("\n"),
    );
    const report = doctor(target);
    expect(report.ok).toBe(false);
    expect(report.issues).toContain("below_minimum_secure:@codelitdev/platform");
  });

  it("does not create into a non-empty directory", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cli-full-"));
    writeFileSync(path.join(dir, "keep.txt"), "1");
    expect(() => createProduct({ targetDir: dir, productName: "Nope" })).toThrow(
      "create_target_not_empty",
    );
  });
});
