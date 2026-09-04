import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type PackagePin = {
  recommended: string;
  supported: string;
  minimumSecure: string;
};

export type PresetManifest = {
  schemaVersion: 1;
  presetVersion: string;
  runtime: { node: string; pnpm: string };
  packages: Record<string, PackagePin>;
  external: Record<string, string>;
};

const manifestPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "manifest.json",
);

export function loadPresetManifest(): PresetManifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as PresetManifest;
}

function parseVersion(value: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
} | null {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(
    value,
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    prerelease: match[4]?.split(".") ?? [],
  };
}

function cmp(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return a.localeCompare(b);
  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] !== pb[key]) return pa[key] - pb[key];
  }
  if (pa.prerelease.length === 0 && pb.prerelease.length > 0) return 1;
  if (pa.prerelease.length > 0 && pb.prerelease.length === 0) return -1;
  for (
    let i = 0;
    i < Math.max(pa.prerelease.length, pb.prerelease.length);
    i += 1
  ) {
    const left = pa.prerelease[i];
    const right = pb.prerelease[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const leftNumber = /^\d+$/.test(left);
    const rightNumber = /^\d+$/.test(right);
    if (leftNumber && rightNumber) return Number(left) - Number(right);
    if (leftNumber) return -1;
    if (rightNumber) return 1;
    return left.localeCompare(right);
  }
  return 0;
}

function satisfies(version: string, range: string): boolean {
  const clauses = range.split(/\s+/).filter(Boolean);
  return clauses.every((clause) => {
    const match = /^(>=|<=|>|<|=)?(.+)$/.exec(clause);
    if (!match) return false;
    const relation = match[1] ?? "=";
    const result = cmp(version, match[2]!);
    if (relation === ">=") return result >= 0;
    if (relation === "<=") return result <= 0;
    if (relation === ">") return result > 0;
    if (relation === "<") return result < 0;
    return result === 0;
  });
}

export type PresetIssue = {
  packageName: string;
  reason:
    | "below_minimum_secure"
    | "unsupported"
    | "external_mismatch"
    | "unknown_package";
  resolved: string;
};

export function validateResolvedVersions(
  resolved: Record<string, string>,
  manifest: PresetManifest = loadPresetManifest(),
): PresetIssue[] {
  const issues: PresetIssue[] = [];
  for (const [name, version] of Object.entries(resolved)) {
    const pin = manifest.packages[name];
    if (!pin && name in manifest.external) {
      if (cmp(version, manifest.external[name]!) !== 0) {
        issues.push({
          packageName: name,
          reason: "external_mismatch",
          resolved: version,
        });
      }
      continue;
    }
    if (!pin) {
      issues.push({
        packageName: name,
        reason: "unknown_package",
        resolved: version,
      });
      continue;
    }
    if (cmp(version, pin.minimumSecure) < 0) {
      issues.push({
        packageName: name,
        reason: "below_minimum_secure",
        resolved: version,
      });
    }
    if (!satisfies(version, pin.supported)) {
      issues.push({
        packageName: name,
        reason: "unsupported",
        resolved: version,
      });
    }
  }
  return issues;
}

export const presetManifest = loadPresetManifest();
