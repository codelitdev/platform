import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = mkdtempSync(path.join(tmpdir(), "codelit-packages-"));

const packages = [
  {
    directory: "packages/platform",
    prepare: "build",
    required: ["package/package.json", "package/dist/index.js"],
    forbidden: ["package/src/", "package/test/"],
  },
  {
    directory: "packages/observability",
    prepare: "build",
    required: ["package/package.json", "package/dist/index.js"],
    forbidden: ["package/src/", "package/test/"],
  },
  {
    directory: "packages/mcp-server-kit",
    prepare: "build",
    required: ["package/package.json", "package/dist/index.js"],
    forbidden: ["package/src/", "package/test/"],
  },
  {
    directory: "packages/platform-preset",
    prepare: "build",
    required: [
      "package/package.json",
      "package/dist/index.js",
      "package/dist/manifest.json",
    ],
    forbidden: ["package/src/", "package/test/"],
  },
  {
    directory: "packages/platform-conformance",
    prepare: "build",
    required: ["package/package.json", "package/dist/index.js"],
    forbidden: ["package/src/", "package/test/"],
  },
  {
    directory: "packages/platform-cli",
    prepare: "build",
    required: ["package/package.json", "package/dist/index.js", "package/dist/bin.js"],
    forbidden: ["package/src/", "package/test/"],
  },
  {
    directory: "packages/oauth-server-kit",
    prepare: "build",
    required: ["package/package.json", "package/dist/index.mjs"],
    forbidden: ["package/src/", "package/test/"],
  },
  {
    directory: "packages/design-system",
    prepare: "check",
    required: [
      "package/package.json",
      "package/src/index.ts",
      "package/src/styles.css",
      "package/tailwind-preset.js",
    ],
    forbidden: ["package/registry/", "package/public/"],
  },
];

const globallyForbidden = ["/node_modules/", "/coverage/", "/.git/", ".tgz"];

try {
  for (const candidate of packages) {
    const directory = path.join(root, candidate.directory);
    execFileSync("bun", ["run", candidate.prepare], {
      cwd: directory,
      stdio: "inherit",
    });
    const before = new Set(readdirSync(outputDirectory));
    execFileSync("bun", ["pm", "pack", "--destination", outputDirectory], {
      cwd: directory,
      stdio: "inherit",
    });
    const tarballName = readdirSync(outputDirectory).find(
      (name) => name.endsWith(".tgz") && !before.has(name),
    );
    if (!tarballName) {
      throw new Error(`No tarball produced for ${candidate.directory}`);
    }

    const listing = execFileSync(
      "tar",
      ["-tzf", path.join(outputDirectory, tarballName)],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n");

    for (const required of candidate.required) {
      if (!listing.includes(required)) {
        throw new Error(`${tarballName} is missing ${required}`);
      }
    }
    for (const forbidden of [...globallyForbidden, ...candidate.forbidden]) {
      if (listing.some((entry) => entry.includes(forbidden))) {
        throw new Error(`${tarballName} contains forbidden path ${forbidden}`);
      }
    }
    if (listing.some((entry) => entry.endsWith("/.env") || entry.includes("/.env/"))) {
      throw new Error(`${tarballName} contains a .env file`);
    }

    process.stdout.write(`packed-contents-ok ${tarballName}\n`);
  }
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
