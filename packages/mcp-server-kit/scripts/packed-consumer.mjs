import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const platformRoot = path.join(root, "..", "platform");
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], {
    cwd: platformRoot,
    stdio: "inherit",
});
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], {
    cwd: root,
    stdio: "inherit",
});
const packDirectory = mkdtempSync(path.join(tmpdir(), "mcp-kit-package-"));
const platformPack = execFileSync(
    "pnpm",
    ["pack", "--pack-destination", packDirectory],
    { cwd: platformRoot, encoding: "utf8" },
);
const packOut = execFileSync("pnpm", ["pack", "--pack-destination", packDirectory], {
    cwd: root,
    encoding: "utf8",
});
function tarballFrom(out) {
    const packedName = out
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.endsWith(".tgz"))
        .at(-1);
    if (!packedName) throw new Error(out);
    return path.isAbsolute(packedName)
        ? packedName
        : path.join(packDirectory, path.basename(packedName));
}
const platformTarball = tarballFrom(platformPack);
const tarball = tarballFrom(packOut);
const dir = mkdtempSync(path.join(tmpdir(), "mcp-kit-packed-"));
mkdirSync(dir, { recursive: true });
writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
        name: "consumer",
        type: "module",
        private: true,
        packageManager: "pnpm@10.22.0",
    }),
);
execFileSync("pnpm", ["add", platformTarball, tarball, "--ignore-scripts"], {
    cwd: dir,
    stdio: "inherit",
});
const pkg = JSON.parse(
    readFileSync(
        path.join(dir, "node_modules/@codelitdev/mcp-server-kit/package.json"),
        "utf8",
    ),
);
if (JSON.stringify(pkg.exports).includes("src/")) throw new Error("src export present");
writeFileSync(
    path.join(dir, "assert.mjs"),
    `
import { createMcpServerKit, validateParityManifest } from "@codelitdev/mcp-server-kit";
const kit = createMcpServerKit({
  name: "c",
  version: "0",
  async authenticate() { return { kind: "absent" }; },
  async resolveContext() { return { ok: false, error: { code: "unauthenticated", message: "x" } }; },
  tools: [{
    name: "t",
    description: "t",
    risk: "read",
    inputSchema: { safeParse: (value) => ({ success: true, data: value }) },
    async handler() { return {}; },
  }],
});
const res = await kit.handle({
  method: "POST",
  headers: { cookie: "better-auth.session_token=x" },
  body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
});
if (res.status !== 401) throw new Error("cookie session accepted");
if (JSON.stringify(kit.listTools()).includes("src/")) throw new Error("src");
validateParityManifest([], { restOperationIds: new Set(), mcpToolNames: new Set() });
console.log("packed-exports-ok");
`,
);
execFileSync("node", [path.join(dir, "assert.mjs")], { cwd: dir, stdio: "inherit" });
console.log(`tarball=${tarball}`);
