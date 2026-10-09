// Rewrites `workspace:` dependency ranges in public packages to real version
// ranges before `changeset publish`. Changesets publishes with `npm publish`,
// which copies `workspace:^` into the published package.json as is, and npm
// cannot install that. Runs on CI's throwaway checkout only.
//
// workspace:^ -> ^<version>, workspace:~ -> ~<version>,
// workspace:* -> <version>, workspace:<range> -> <range>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root =
  process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootManifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

// Expands a workspace pattern one path segment at a time. A segment is either
// a literal name or `*` (every directory at that level). Anything else throws,
// so a pattern this script cannot read never skips a public package silently.
function expand(pattern) {
  let directories = [root];
  for (const segment of pattern.split("/")) {
    if (segment === "*") {
      directories = directories.flatMap((directory) =>
        readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
          .map((entry) => path.join(directory, entry.name)),
      );
    } else if (/[*?[\]{}()!|+]/.test(segment)) {
      throw new Error(`Unsupported workspace pattern: ${pattern}`);
    } else {
      directories = directories
        .map((directory) => path.join(directory, segment))
        .filter((directory) => existsSync(directory));
    }
  }
  return directories
    .map((directory) => path.join(directory, "package.json"))
    .filter((file) => existsSync(file));
}

const manifests = rootManifest.workspaces.flatMap(expand).map((file) => ({
  file,
  json: JSON.parse(readFileSync(file, "utf8")),
}));
const versions = new Map(manifests.map(({ json }) => [json.name, json.version]));

function resolve(name, range) {
  const version = versions.get(name);
  if (!version) throw new Error(`No workspace package named ${name}`);
  const spec = range.slice("workspace:".length);
  if (spec === "^" || spec === "~") return `${spec}${version}`;
  if (spec === "*") return version;
  return spec;
}

const fields = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "devDependencies",
];
for (const { file, json } of manifests) {
  if (json.private) continue;
  let changed = false;
  for (const field of fields) {
    for (const [name, range] of Object.entries(json[field] || {})) {
      if (typeof range !== "string" || !range.startsWith("workspace:")) continue;
      json[field][name] = resolve(name, range);
      console.log(`${json.name}: ${name} ${range} -> ${json[field][name]}`);
      changed = true;
    }
  }
  if (changed) writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}
