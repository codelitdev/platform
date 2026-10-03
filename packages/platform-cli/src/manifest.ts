import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type PlatformManifest = {
  schemaVersion: 2;
  /** Template tokens; `sync` re-renders managed files with them. */
  product: { name: string; slug: string };
  /** The CLI release that last wrote the managed files; its preset applies. */
  cliVersion: string;
  capabilities: string[];
  managedFiles: Record<string, string>;
  productOwnedGlobs: string[];
};

/** Written by CLI releases before `sync` replaced versioned upgrades. */
type ManifestV1 = {
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
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<
    PlatformManifest | ManifestV1
  >;
  const manifest = raw.schemaVersion === 1 ? migrateV1(root, raw) : raw;
  if (
    manifest.schemaVersion !== 2 ||
    typeof manifest.product?.name !== "string" ||
    typeof manifest.product?.slug !== "string" ||
    typeof manifest.cliVersion !== "string" ||
    !Array.isArray(manifest.capabilities) ||
    !Array.isArray(manifest.productOwnedGlobs) ||
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

/**
 * v1 did not record template tokens. `create` names the root package after
 * the product slug, so the slug doubles as the name, as it does when a
 * product is created from a directory basename.
 */
function migrateV1(
  root: string,
  manifest: Partial<ManifestV1>,
): Partial<PlatformManifest> {
  const pkgPath = path.join(root, "package.json");
  const slug = existsSync(pkgPath)
    ? (JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: unknown }).name
    : undefined;
  if (typeof slug !== "string" || !slug) throw new Error("platform_manifest_invalid");
  return {
    schemaVersion: 2,
    product: { name: slug, slug },
    cliVersion: "0.0.0",
    capabilities: manifest.capabilities,
    managedFiles: manifest.managedFiles,
    productOwnedGlobs: manifest.productOwnedGlobs,
  };
}

export function writeManifest(root: string, manifest: PlatformManifest): void {
  writeFileSync(
    path.join(root, MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 4)}\n`,
  );
}
