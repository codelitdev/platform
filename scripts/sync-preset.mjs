// Keeps the CLI's preset (packages/platform-cli/src/preset.json) in step with
// what it describes. Run after
// `changeset version`; `--check` fails instead of writing.
//
// - `packages.*.recommended`: all @codelitdev packages release together
//   (changesets `fixed` group), so this is the current package version.
// - `external`: the template is the specification, so each pinned external
//   dependency takes the exact version the template declares. Externals the
//   template does not use stay hand-maintained.
// `supported` and `minimumSecure` remain hand-maintained.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const manifestPath = path.join(root, "packages/platform-cli/src/preset.json");
const before = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(before);
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

const versions = new Map(
  readdirSync(path.join(root, "packages")).map((dir) => {
    const pkg = readJson(path.join(root, "packages", dir, "package.json"));
    return [pkg.name, pkg.version];
  }),
);
for (const [name, pin] of Object.entries(manifest.packages)) {
  const version = versions.get(name);
  if (!version) throw new Error(`preset_package_missing:${name}`);
  pin.recommended = version;
}

const template = path.join(root, "templates/saas-product");
const templateManifests = [
  "package.json",
  "apps/api/package.json",
  "apps/web/package.json",
  "packages/api-contract/package.json",
];
const declared = new Map();
for (const rel of templateManifests) {
  const pkg = readJson(path.join(template, rel));
  for (const [name, spec] of Object.entries({
    ...pkg.dependencies,
    ...pkg.devDependencies,
  })) {
    if (!(name in manifest.external)) continue;
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(spec)) {
      throw new Error(`template_external_not_exact:${rel}:${name}@${spec}`);
    }
    const seen = declared.get(name);
    if (seen && seen.spec !== spec) {
      throw new Error(
        `template_external_conflict:${name}:${seen.rel}@${seen.spec}:${rel}@${spec}`,
      );
    }
    declared.set(name, { rel, spec });
  }
}
for (const [name, { spec }] of declared) manifest.external[name] = spec;

const after = `${JSON.stringify(manifest, null, 2)}\n`;
if (check) {
  if (after !== before) {
    process.stderr.write(
      "preset_out_of_sync: run `bun scripts/sync-preset.mjs` and commit the preset\n",
    );
    process.exit(1);
  }
} else {
  writeFileSync(manifestPath, after);
}
