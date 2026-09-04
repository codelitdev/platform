import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertGitClean } from "./git.js";
import { sha256File } from "./hash.js";
import { readManifest, writeManifest } from "./manifest.js";

export type UpgradeResult = {
  dryRun: boolean;
  changed: string[];
  conflicts: string[];
  restored?: string[];
};

export function upgradeProduct(input: {
  root: string;
  version?: string;
  dryRun?: boolean;
  allowDirty?: boolean;
  failAfterWrite?: boolean;
}): UpgradeResult {
  const root = path.resolve(input.root);
  if (!input.dryRun && !input.allowDirty) {
    assertGitClean(root);
  }
  const manifest = readManifest(root);
  const changed: string[] = [];
  const conflicts: string[] = [];
  const plannedWrites = new Map<string, string>();
  const upgradeVersion = input.version ?? "1.1.0";

  // Compute and validate the complete plan before touching any file. A
  // managed hash mismatch is a conflict, not a best-effort warning.
  for (const [rel, expected] of Object.entries(manifest.managedFiles)) {
    const current = path.join(root, rel);
    if (!existsSync(current) || sha256File(current) !== expected) {
      conflicts.push(rel);
      continue;
    }
    // Managed files are not automatically source files. A version marker is
    // intentionally owned by the managed TypeScript config only; appending it
    // to every managed file corrupts assets such as GitHub Actions YAML.
    if (rel !== "tooling/platform/config.ts") continue;
    const currentText = readFileSync(current, "utf8");
    const marker = /export const platformTemplateVersion = "[^"]*";\n?/;
    const nextText = marker.test(currentText)
      ? currentText.replace(
          marker,
          `export const platformTemplateVersion = "${upgradeVersion}";\n`,
        )
      : `${currentText.trimEnd()}\nexport const platformTemplateVersion = "${upgradeVersion}";\n`;
    if (nextText !== currentText) {
      plannedWrites.set(rel, nextText);
      changed.push(rel);
    }
  }

  const productName =
    JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).name ?? "product";
  const readme = path.join(root, "apps/api/README.md");
  if (!existsSync(readme)) {
    throw new Error("codemod_input_unsupported");
  }
  const readmeText = readFileSync(readme, "utf8");
  const expectedTitle = `# ${String(productName)} API`;
  const readmeLines = readmeText.split("\n");
  if (!readmeLines[0]?.startsWith("# ")) {
    throw new Error("codemod_input_unsupported");
  }
  if (readmeLines[0] !== expectedTitle) {
    changed.push("apps/api/README.md");
    if (!input.dryRun) {
      readmeLines[0] = expectedTitle;
      plannedWrites.set("apps/api/README.md", readmeLines.join("\n"));
    }
  }

  // Never mutate anything if any managed file is conflicted. This also makes
  // the result deterministic for callers that use dry-run to gate a write.
  if (conflicts.length > 0) {
    return { dryRun: Boolean(input.dryRun), changed: [], conflicts };
  }
  if (input.dryRun) {
    return { dryRun: true, changed, conflicts };
  }

  const backups = new Map<string, string>();
  const manifestPath = path.join(root, ".codelit-platform.json");
  backups.set(".codelit-platform.json", readFileSync(manifestPath, "utf8"));
  try {
    for (const [rel, content] of plannedWrites) {
      const file = path.join(root, rel);
      backups.set(rel, readFileSync(file, "utf8"));
      writeFileSync(file, content);
      if (rel in manifest.managedFiles) {
        manifest.managedFiles[rel] = sha256File(file);
      }
    }
    if (input.failAfterWrite) throw new Error("upgrade_forced_failure");
    if (!manifest.appliedUpgrades.includes(upgradeVersion)) {
      manifest.appliedUpgrades.push(upgradeVersion);
    }
    manifest.templateVersion = upgradeVersion;
    writeManifest(root, manifest);
    return { dryRun: false, changed, conflicts };
  } catch (error) {
    const restored: string[] = [];
    for (const [rel, content] of backups) {
      writeFileSync(path.join(root, rel), content);
      restored.push(rel);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}; upgrade_rolled_back:${restored.join(",")}`, {
      cause: error,
    });
  }
}
