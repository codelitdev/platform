import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  loadPresetManifest,
  validateResolvedVersions,
} from "@codelitdev/platform-preset";
import { sha256File } from "./hash.js";
import { readManifest } from "./manifest.js";

export type DoctorReport = {
  ok: boolean;
  issues: string[];
};

export function doctor(root: string): DoctorReport {
  const issues: string[] = [];
  try {
    const manifest = readManifest(root);
    const preset = loadPresetManifest();
    for (const [rel, expected] of Object.entries(manifest.managedFiles)) {
      const file = path.join(root, rel);
      if (!existsSync(file)) {
        issues.push(`managed_file_missing:${rel}`);
        continue;
      }
      const actual = sha256File(file);
      if (actual !== expected) {
        issues.push(`managed_hash_mismatch:${rel}`);
      }
    }
    const resolved = resolveCodelitVersions(root, [
      ...Object.keys(preset.packages),
      ...Object.keys(preset.external),
    ]);
    Object.assign(
      resolved,
      resolveLockfileVersions(root, new Set(Object.keys(preset.packages))),
    );
    issues.push(
      ...validateResolvedVersions(resolved, preset).map(
        (issue) => `${issue.reason}:${issue.packageName}`,
      ),
    );
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Read direct importer resolutions from pnpm lockfile v9 without requiring a
 * YAML parser at CLI runtime. Package manifests describe intent; this catches
 * a stale lockfile that would actually install an unsupported package.
 */
export function resolveLockfileVersions(
  root: string,
  managedNames: ReadonlySet<string>,
): Record<string, string> {
  const lockfile = path.join(root, "pnpm-lock.yaml");
  if (!existsSync(lockfile)) return {};
  const importerSection = readFileSync(lockfile, "utf8").split("\npackages:")[0] ?? "";
  const resolved: Record<string, string> = {};
  let dependencyName: string | undefined;
  for (const line of importerSection.split("\n")) {
    const dependency = /^\s{6}(?:'([^']+)'|([^:\s]+)):\s*$/.exec(line);
    if (dependency) {
      const name = dependency[1] ?? dependency[2];
      dependencyName = name && managedNames.has(name) ? name : undefined;
      continue;
    }
    const version = /^\s{8}version:\s*([^\s(]+)/.exec(line);
    if (dependencyName && version?.[1]) {
      const normalized = version[1].replace(/^link:/, "");
      if (!normalized.startsWith("../")) resolved[dependencyName] = normalized;
      dependencyName = undefined;
      continue;
    }
    if (/^\s{6}\S/.test(line)) dependencyName = undefined;
  }
  return resolved;
}

function collectPackageJsonFiles(root: string): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".git" || entry === "dist") {
        continue;
      }
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry === "package.json") files.push(full);
    }
  }
  if (existsSync(root)) walk(root);
  return files;
}

export function resolveCodelitVersions(
  root: string,
  managedNames?: readonly string[],
): Record<string, string> {
  const resolved: Record<string, string> = {};
  const names = managedNames ? new Set(managedNames) : undefined;
  for (const pkgPath of collectPackageJsonFiles(root)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const specs = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, spec] of Object.entries(specs)) {
      if (!name.startsWith("@codelitdev/") && !names?.has(name)) continue;
      const installed = findInstalledPackageJson(
        path.dirname(pkgPath),
        root,
        name,
      );
      if (installed) {
        const version = (
          JSON.parse(readFileSync(installed, "utf8")) as { version: string }
        ).version;
        resolved[name] = version;
        continue;
      }
      if (spec.startsWith("workspace:")) continue;
      resolved[name] = spec.replace(/^[\^~]/, "");
    }
  }
  return resolved;
}

function findInstalledPackageJson(
  packageDir: string,
  root: string,
  name: string,
): string | undefined {
  let current = packageDir;
  while (true) {
    const candidate = path.join(
      current,
      "node_modules",
      ...name.split("/"),
      "package.json",
    );
    if (existsSync(candidate)) return candidate;
    if (current === root) return undefined;
    const parent = path.dirname(current);
    if (parent === current || !parent.startsWith(root)) return undefined;
    current = parent;
  }
}
