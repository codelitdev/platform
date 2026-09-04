import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const presetRoot = path.join(root, "..", "platform-preset");
execFileSync("pnpm", ["run", "build"], { cwd: presetRoot, stdio: "inherit" });
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], {
  cwd: root,
  stdio: "inherit",
});
rmSync(path.join(root, "template"), { recursive: true, force: true });
cpSync(
  path.resolve(root, "../../templates/saas-product"),
  path.join(root, "template"),
  {
    recursive: true,
  },
);
const packDirectory = mkdtempSync(path.join(tmpdir(), "cli-package-"));
function pack(cwd) {
  const out = execFileSync(
    "pnpm",
    ["pack", "--pack-destination", packDirectory],
    {
      cwd,
      encoding: "utf8",
    },
  );
  const name = out
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".tgz"))
    .at(-1);
  if (!name) throw new Error(out);
  return path.isAbsolute(name)
    ? name
    : path.join(packDirectory, path.basename(name));
}
const presetTarball = pack(presetRoot);
const tarball = pack(root);
const dir = mkdtempSync(path.join(tmpdir(), "cli-packed-"));
mkdirSync(dir, { recursive: true });
writeFileSync(
  path.join(dir, "package.json"),
  JSON.stringify({
    name: "consumer",
    type: "module",
    private: true,
    packageManager: "pnpm@10.22.0",
    dependencies: {
      "@codelitdev/platform-preset": presetTarball,
      "@codelitdev/platform-cli": tarball,
    },
    pnpm: {
      overrides: {
        "@codelitdev/platform-preset": presetTarball,
      },
    },
  }),
);
execFileSync("pnpm", ["install", "--ignore-scripts"], {
  cwd: dir,
  stdio: "inherit",
});
const pkg = JSON.parse(
  readFileSync(
    path.join(dir, "node_modules/@codelitdev/platform-cli/package.json"),
    "utf8",
  ),
);
if (JSON.stringify(pkg.exports).includes("src/")) throw new Error("src export");
writeFileSync(
  path.join(dir, "assert.mjs"),
  `
import { createProduct, doctor } from "@codelitdev/platform-cli";
if (typeof createProduct !== "function") throw new Error("create");
if (typeof doctor !== "function") throw new Error("doctor");
console.log("packed-exports-ok");
`,
);
execFileSync("node", [path.join(dir, "assert.mjs")], {
  cwd: dir,
  stdio: "inherit",
});
console.log(`tarball=${tarball}`);
