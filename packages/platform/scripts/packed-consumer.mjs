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
const packDirectory = mkdtempSync(path.join(tmpdir(), "platform-package-"));
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
if (!packedName) {
  throw new Error(`bun pm pack did not print a tarball:\n${packOut}`);
}
const tarball = path.isAbsolute(packedName)
  ? packedName
  : path.join(packDirectory, path.basename(packedName));
const dir = mkdtempSync(path.join(tmpdir(), "platform-packed-"));
mkdirSync(dir, { recursive: true });
writeFileSync(
  path.join(dir, "package.json"),
  JSON.stringify(
    {
      name: "consumer",
      type: "module",
      private: true,
      packageManager: "bun@1.4.1",
    },
    null,
    2,
  ),
);
execFileSync("bun", ["add", tarball, "--ignore-scripts"], {
  cwd: dir,
  stdio: "inherit",
});
const pkg = JSON.parse(
  readFileSync(
    path.join(dir, "node_modules/@codelitdev/platform/package.json"),
    "utf8",
  ),
);
if (JSON.stringify(pkg.exports).includes("src/")) {
  throw new Error("src export present");
}
if (!pkg.exports["."]?.import) {
  throw new Error("missing root export");
}
writeFileSync(
  path.join(dir, "assert.mjs"),
  `
import {
  PLATFORM_ERROR_CODES,
  createPlatformError,
  extractHttpCredentials,
  mapThrownException,
  mapTransportAuthentication,
  toPublicHttpError,
} from "@codelitdev/platform";

if (!PLATFORM_ERROR_CODES.includes("credential_ambiguous")) {
  throw new Error("missing credential_ambiguous");
}
const mapped = mapTransportAuthentication(
  { kind: "absent" },
  { transport: "http" },
);
if (mapped.kind !== "rejected" || mapped.error.code !== "unauthenticated") {
  throw new Error("protected absent mapping failed");
}
const http = toPublicHttpError(mapThrownException(new Error("secret-cause")));
if (http.status !== 500 || JSON.stringify(http.body).includes("secret-cause")) {
  throw new Error("cause leaked");
}
const extracted = extractHttpCredentials({ authorization: "Bearer tok" });
if (extracted.some((item) => item.kind === "system")) {
  throw new Error("system credential from HTTP");
}
if (createPlatformError("forbidden").message.includes("cause")) {
  throw new Error("message derived from cause");
}
console.log("packed-exports-ok");
`,
);
execFileSync("bun", [path.join(dir, "assert.mjs")], {
  cwd: dir,
  stdio: "inherit",
});
console.log(`tarball=${tarball}`);
console.log(`consumer=${dir}`);
