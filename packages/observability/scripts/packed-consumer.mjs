import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
execFileSync("bun", ["x", "tsc", "-p", "tsconfig.json"], {
  cwd: root,
  stdio: "inherit",
});
const packDirectory = mkdtempSync(path.join(tmpdir(), "observability-package-"));
const packOut = execFileSync("bun", ["pm", "pack", "--destination", packDirectory], {
  cwd: root,
  encoding: "utf8",
});
const packedName = packOut
  .trim()
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith(".tgz"))
  .at(-1);
if (!packedName) throw new Error(packOut);
const tarball = path.isAbsolute(packedName)
  ? packedName
  : path.join(packDirectory, path.basename(packedName));
const dir = mkdtempSync(path.join(tmpdir(), "observability-packed-"));
mkdirSync(dir, { recursive: true });
writeFileSync(
  path.join(dir, "package.json"),
  JSON.stringify({
    name: "consumer",
    type: "module",
    private: true,
    packageManager: "bun@1.4.1",
  }),
);
execFileSync("bun", ["add", tarball, "--ignore-scripts"], {
  cwd: dir,
  stdio: "inherit",
});
const pkg = JSON.parse(
  readFileSync(
    path.join(dir, "node_modules/@codelitdev/observability/package.json"),
    "utf8",
  ),
);
if (JSON.stringify(pkg.exports).includes("src/")) throw new Error("src export present");
writeFileSync(
  path.join(dir, "assert.mjs"),
  `
import { createObservability } from "@codelitdev/observability";
import { createBrowserObservability } from "@codelitdev/observability/browser";
const obs = createObservability({
  serviceName: "consumer",
  environment: "test",
  contextPolicy: { propertyAllowlist: new Set(["job_id"]) },
});
if (obs.enabled) throw new Error("should be disabled");
if (typeof obs.logger.info !== "function") throw new Error("logger");
obs.captureException({ error: new Error("x"), source: "t" });
const browser = createBrowserObservability({
  serviceName: "consumer-web",
  environment: "test",
});
if (browser.enabled) throw new Error("browser should be disabled");
await browser.init();
console.log("packed-exports-ok");
`,
);
execFileSync("bun", [path.join(dir, "assert.mjs")], { cwd: dir, stdio: "inherit" });
console.log(`tarball=${tarball}`);
