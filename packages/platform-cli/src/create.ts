import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { copyTemplate, isEmptyDir, listFiles, removeDir, replaceTokens } from "./fs.js";
import { sha256File } from "./hash.js";
import { writeManifest } from "./manifest.js";
import { loadPresetManifest } from "./preset.js";
import {
  cliVersion,
  MANAGED_FILES,
  resolveTemplateDir,
  slugify,
  templateTokens,
} from "./template.js";

export function createProduct(input: { targetDir: string; productName: string }): {
  root: string;
} {
  const target = path.resolve(input.targetDir);
  if (existsSync(target) && !isEmptyDir(target)) {
    throw new Error("create_target_not_empty");
  }
  const slug = slugify(input.productName);
  const staging = `${target}.staging-${process.pid}`;
  removeDir(staging);
  try {
    copyTemplate(resolveTemplateDir(), staging);
    renameSync(
      path.join(staging, "biome.template.json"),
      path.join(staging, "biome.json"),
    );
    const product = { name: input.productName, slug };
    replaceTokens(staging, templateTokens(product));
    const preset = loadPresetManifest();
    pinCodelitVersions(staging, preset);
    writeManifest(staging, {
      schemaVersion: 2,
      product,
      cliVersion: cliVersion(),
      capabilities: ["auth", "mcp", "observability", "billing"],
      managedFiles: Object.fromEntries(
        MANAGED_FILES.map((rel) => [rel, sha256File(path.join(staging, rel))]),
      ),
      productOwnedGlobs: ["apps/**", "packages/api-contract/**"],
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
    "biome.json",
    "apps/api/package.json",
    "apps/web/package.json",
    "packages/api-contract/package.json",
    "apps/api/README.md",
    ".github/workflows/platform-conformance.yml",
    ".github/workflows/code-quality.yml",
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
    if (content.includes("__PRODUCT_") || content.includes("__PLATFORM_"))
      throw new Error("create_tokens_unresolved");
  }
  const packageJson = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as {
    packageManager?: string;
  };
  if (packageJson.packageManager !== "bun@1.4.1") {
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
        if (!name.startsWith("@codelitdev/") || !spec.startsWith("workspace:")) {
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
