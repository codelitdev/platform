import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type PlatformManifest = {
  schemaVersion: 1;
  templateVersion: string;
  presetVersion: string;
  capabilities: string[];
  managedFiles: Record<string, string>;
  productOwnedGlobs: string[];
  appliedUpgrades: string[];
};

export const MANIFEST_NAME = ".codelit-platform.json";

export function readManifest(root: string): PlatformManifest {
  const file = path.join(root, MANIFEST_NAME);
  if (!existsSync(file)) throw new Error("platform_manifest_missing");
  const manifest = JSON.parse(
    readFileSync(file, "utf8"),
  ) as Partial<PlatformManifest>;
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.templateVersion !== "string" ||
    typeof manifest.presetVersion !== "string" ||
    !Array.isArray(manifest.capabilities) ||
    !Array.isArray(manifest.productOwnedGlobs) ||
    !Array.isArray(manifest.appliedUpgrades) ||
    !manifest.managedFiles ||
    typeof manifest.managedFiles !== "object"
  ) {
    throw new Error("platform_manifest_invalid");
  }
  for (const [rel, hash] of Object.entries(manifest.managedFiles)) {
    const resolved = path.resolve(root, rel);
    if (
      path.isAbsolute(rel) ||
      (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) ||
      !/^[a-f0-9]{64}$/i.test(hash)
    ) {
      throw new Error("platform_manifest_invalid");
    }
  }
  return manifest as PlatformManifest;
}

export function writeManifest(root: string, manifest: PlatformManifest): void {
  writeFileSync(
    path.join(root, MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 4)}\n`,
  );
}
