import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { loadPresetManifest } from "@codelitdev/platform-preset";
import {
  copyTemplate,
  isEmptyDir,
  listFiles,
  removeDir,
  replaceTokens,
} from "./fs.js";
import { sha256File } from "./hash.js";
import { writeManifest } from "./manifest.js";
import { resolveTemplateDir, slugify } from "./template.js";

export function createProduct(input: {
  targetDir: string;
  productName: string;
}): { root: string } {
  const target = path.resolve(input.targetDir);
  if (existsSync(target) && !isEmptyDir(target)) {
    throw new Error("create_target_not_empty");
  }
  const slug = slugify(input.productName);
  const staging = `${target}.staging-${process.pid}`;
  removeDir(staging);
  try {
    copyTemplate(resolveTemplateDir(), staging);
    replaceTokens(staging, {
      __PRODUCT_NAME__: input.productName,
      __PRODUCT_SLUG__: slug,
    });
    pinCodelitVersions(staging, loadPresetManifest());
    const managedRel = path.join("tooling", "platform", "config.ts");
    const managedPath = path.join(staging, managedRel);
    const workflowRel = path.join(
      ".github",
      "workflows",
      "platform-conformance.yml",
    );
    const workflowPath = path.join(staging, workflowRel);
    const preset = loadPresetManifest();
    writeManifest(staging, {
      schemaVersion: 1,
      templateVersion: "1.0.0",
      presetVersion: preset.presetVersion,
      capabilities: ["auth", "mcp", "observability", "billing"],
      managedFiles: {
        [managedRel.replaceAll("\\", "/")]: sha256File(managedPath),
        [workflowRel.replaceAll("\\", "/")]: sha256File(workflowPath),
      },
      productOwnedGlobs: ["apps/**", "packages/api-contract/**"],
      appliedUpgrades: ["1.0.0"],
    });
    validateGeneratedMetadata(staging);
    mkdirSync(path.dirname(target), { recursive: true });
    if (existsSync(target)) removeDir(target);
    renameSync(staging, target);
    return { root: target };
  } catch (error) {
    removeDir(staging);
    throw error;
  }
}

function validateGeneratedMetadata(root: string): void {
  const files = listFiles(root);
  const required = [
    "package.json",
    "pnpm-workspace.yaml",
    "apps/api/package.json",
    "apps/web/package.json",
    "packages/api-contract/package.json",
    "apps/api/README.md",
    ".github/workflows/platform-conformance.yml",
  ];
  if (required.some((file) => !files.includes(file))) {
    throw new Error("create_metadata_invalid");
  }
  for (const file of files) {
    if (
      !file.endsWith(".json") &&
      !file.endsWith(".ts") &&
      !file.endsWith(".tsx") &&
      !file.endsWith(".md") &&
      !file.endsWith(".yml")
    )
      continue;
    const content = readFileSync(path.join(root, file), "utf8");
    if (content.includes("__PRODUCT_"))
      throw new Error("create_tokens_unresolved");
  }
  const packageJson = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as {
    packageManager?: string;
  };
  if (packageJson.packageManager !== "pnpm@10.22.0") {
    throw new Error("create_metadata_invalid");
  }
}

function pinCodelitVersions(
  root: string,
  preset: ReturnType<typeof loadPresetManifest>,
): void {
  for (const rel of listFiles(root)) {
    if (!rel.endsWith("package.json")) continue;
    const full = path.join(root, rel);
    const pkg = JSON.parse(readFileSync(full, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    let changed = false;
    for (const field of ["dependencies", "devDependencies"] as const) {
      const deps = pkg[field];
      if (!deps) continue;
      for (const [name, spec] of Object.entries(deps)) {
        const packagePin = preset.packages[name];
        const externalPin = preset.external[name];
        if (packagePin && spec.startsWith("workspace:")) {
          deps[name] = packagePin.recommended;
          changed = true;
          continue;
        }
        if (externalPin) {
          const next = externalPin;
          if (spec === next) continue;
          deps[name] = next;
          changed = true;
          continue;
        }
        if (
          !name.startsWith("@codelitdev/") ||
          !spec.startsWith("workspace:")
        ) {
          continue;
        }
        const pin = packagePin;
        const next = pin?.recommended ?? spec.replace(/^workspace:/, "");
        if (next === "*" || next.startsWith("workspace:")) continue;
        deps[name] = next;
        changed = true;
      }
    }
    if (changed) writeFileSync(full, `${JSON.stringify(pkg, null, 4)}\n`);
  }
}
