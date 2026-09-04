import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
execFileSync("pnpm", ["run", "build"], { cwd: root, stdio: "inherit" });
const packDirectory = mkdtempSync(path.join(tmpdir(), "preset-package-"));
const packOut = execFileSync("pnpm", ["pack", "--pack-destination", packDirectory], {
    cwd: root,
    encoding: "utf8",
});
const packedName = packOut.trim().split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".tgz")).at(-1);
if (!packedName) throw new Error(packOut);
const tarball = path.isAbsolute(packedName) ? packedName : path.join(packDirectory, path.basename(packedName));
const dir = mkdtempSync(path.join(tmpdir(), "preset-packed-"));
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "consumer", type: "module", private: true, packageManager: "pnpm@10.22.0" }));
execFileSync("pnpm", ["add", tarball, "--ignore-scripts"], { cwd: dir, stdio: "inherit" });
const pkg = JSON.parse(readFileSync(path.join(dir, "node_modules/@codelitdev/platform-preset/package.json"), "utf8"));
if (JSON.stringify(pkg.exports).includes("src/")) throw new Error("src export present");
writeFileSync(
    path.join(dir, "assert.mjs"),
    `import { loadPresetManifest, validateResolvedVersions } from "@codelitdev/platform-preset";
const m = loadPresetManifest();
if (m.schemaVersion !== 1) throw new Error("schema");
if (!m.packages["@codelitdev/platform"].minimumSecure) throw new Error("pin");
validateResolvedVersions({});
console.log("packed-exports-ok");
`,
);
execFileSync("node", [path.join(dir, "assert.mjs")], { cwd: dir, stdio: "inherit" });
console.log(`tarball=${tarball}`);
