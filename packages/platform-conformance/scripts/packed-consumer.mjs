import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const platformRoot = path.join(root, "..", "platform");
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], { cwd: platformRoot, stdio: "inherit" });
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], { cwd: root, stdio: "inherit" });
const packDirectory = mkdtempSync(path.join(tmpdir(), "conformance-package-"));
function pack(cwd) {
    const out = execFileSync("pnpm", ["pack", "--pack-destination", packDirectory], { cwd, encoding: "utf8" });
    const name = out.trim().split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".tgz")).at(-1);
    if (!name) throw new Error(out);
    return path.isAbsolute(name) ? name : path.join(packDirectory, path.basename(name));
}
const platformTarball = pack(platformRoot);
const tarball = pack(root);
const dir = mkdtempSync(path.join(tmpdir(), "conformance-packed-"));
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "consumer", type: "module", private: true, packageManager: "pnpm@10.22.0" }));
execFileSync("pnpm", ["add", platformTarball, tarball, "--ignore-scripts"], { cwd: dir, stdio: "inherit" });
const pkg = JSON.parse(readFileSync(path.join(dir, "node_modules/@codelitdev/platform-conformance/package.json"), "utf8"));
if (JSON.stringify(pkg.exports).includes("src/")) throw new Error("src export");
writeFileSync(path.join(dir, "assert.mjs"), `
import { runPlatformConformance } from "@codelitdev/platform-conformance";
if (typeof runPlatformConformance !== "function") throw new Error("missing run");
console.log("packed-exports-ok");
`);
execFileSync("node", [path.join(dir, "assert.mjs")], { cwd: dir, stdio: "inherit" });
console.log(`tarball=${tarball}`);
