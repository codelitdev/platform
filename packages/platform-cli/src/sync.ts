import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertGitClean } from "./git.js";
import { sha256File, sha256Text } from "./hash.js";
import { readManifest, writeManifest } from "./manifest.js";
import { cliVersion, MANAGED_FILES, renderTemplateFile } from "./template.js";

export type SyncResult = {
  dryRun: boolean;
  /** Managed files this sync writes or creates. */
  changed: string[];
  /** Managed files edited since the last Platform operation; nothing is written. */
  conflicts: string[];
  /** Files the CLI no longer manages; they stay in place as product-owned. */
  released: string[];
};

/**
 * Bring a product's managed files to the template shipped with this CLI.
 * Product-owned files are never touched: changes to them are documented in the
 * release notes and applied by the product.
 */
export function syncProduct(input: {
  root: string;
  dryRun?: boolean;
  allowDirty?: boolean;
  failAfterWrite?: boolean;
}): SyncResult {
  const root = path.resolve(input.root);
  const dryRun = Boolean(input.dryRun);
  if (!dryRun && !input.allowDirty) assertGitClean(root);
  const manifest = readManifest(root);
  const changed: string[] = [];
  const conflicts: string[] = [];
  const plannedWrites = new Map<string, string>();
  const managedFiles: Record<string, string> = {};

  // Compute and validate the complete plan before touching any file. A
  // managed hash mismatch is a conflict, not a best-effort warning. A new
  // managed file may be adopted only when it is absent or already identical.
  for (const rel of MANAGED_FILES) {
    const file = path.join(root, rel);
    const desired = renderTemplateFile(rel, manifest.product);
    const recorded = manifest.managedFiles[rel];
    const current = existsSync(file) ? readFileSync(file, "utf8") : undefined;
    const drifted =
      recorded === undefined
        ? current !== undefined && current !== desired
        : current === undefined || sha256File(file) !== recorded;
    if (drifted) {
      conflicts.push(rel);
      continue;
    }
    managedFiles[rel] = sha256Text(desired);
    if (current !== desired) {
      plannedWrites.set(rel, desired);
      changed.push(rel);
    }
  }
  const released = Object.keys(manifest.managedFiles).filter(
    (rel) => !(MANAGED_FILES as readonly string[]).includes(rel),
  );

  if (conflicts.length > 0) return { dryRun, changed: [], conflicts, released: [] };
  if (dryRun) return { dryRun, changed, conflicts, released };

  const manifestPath = path.join(root, ".codelit-platform.json");
  const backups = new Map<string, string | undefined>([
    [".codelit-platform.json", readFileSync(manifestPath, "utf8")],
  ]);
  try {
    for (const [rel, content] of plannedWrites) {
      const file = path.join(root, rel);
      backups.set(rel, existsSync(file) ? readFileSync(file, "utf8") : undefined);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    if (input.failAfterWrite) throw new Error("sync_forced_failure");
    // Listing fields drops ones earlier releases wrote, such as presetVersion.
    writeManifest(root, {
      schemaVersion: 2,
      product: manifest.product,
      cliVersion: cliVersion(),
      capabilities: manifest.capabilities,
      managedFiles,
      productOwnedGlobs: manifest.productOwnedGlobs,
    });
    return { dryRun, changed, conflicts, released };
  } catch (error) {
    const restored: string[] = [];
    for (const [rel, content] of backups) {
      const file = path.join(root, rel);
      if (content === undefined) rmSync(file, { force: true });
      else writeFileSync(file, content);
      restored.push(rel);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}; sync_rolled_back:${restored.join(",")}`, {
      cause: error,
    });
  }
}
