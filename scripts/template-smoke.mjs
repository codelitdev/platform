import { execFileSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(path.join(tmpdir(), "codelit-template-smoke-"));
const target = path.join(work, "product");
const packed = path.join(work, "packed");
const packageDirectories = [
  "platform",
  "observability",
  "mcp-server-kit",
  "platform-preset",
  "platform-conformance",
  "billing",
  "oauth-server-kit",
  "design-system",
];

function run(command, args, cwd = root) {
  const quietPack = command === "pnpm" && args.includes("pack");
  execFileSync(command, args, {
    cwd,
    stdio: quietPack ? "ignore" : "inherit",
    env: process.env,
  });
}

async function smokeHttp() {
  if (!process.env.DATABASE_URL) return;
  const port = "45123";
  const child = spawn("pnpm", ["start"], {
    cwd: path.join(target, "apps", "api"),
    env: {
      ...process.env,
      PORT: port,
      PUBLIC_API_URL: `http://127.0.0.1:${port}`,
      AUTH_SECRET:
        process.env.AUTH_SECRET ??
        "smoke-secret-that-is-at-least-thirty-two-characters",
      API_KEY_PEPPER:
        process.env.API_KEY_PEPPER ??
        "smoke-api-key-pepper-that-is-long-enough",
      SEED: "0",
    },
    stdio: "inherit",
  });
  try {
    await new Promise((resolve, reject) => {
      setTimeout(resolve, 8_000);
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code !== null && code !== 0) reject(new Error(`api_exit:${code}`));
      });
    });
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    if (!response.ok) throw new Error(`api_health:${response.status}`);
  } finally {
    child.kill("SIGTERM");
  }
}

async function smokeWeb() {
  const port = "45124";
  const child = spawn(
    "pnpm",
    ["start", "--", "--hostname", "127.0.0.1", "-p", port],
    {
      cwd: path.join(target, "apps", "web"),
      env: { ...process.env, API_URL: "http://127.0.0.1:45123" },
      stdio: "inherit",
    },
  );
  try {
    let response;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/login`);
        if (response.ok) break;
      } catch {
        // Next is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!response?.ok) {
      throw new Error(`web_login:${response?.status ?? "unavailable"}`);
    }
  } finally {
    child.kill("SIGTERM");
  }
}

try {
  run("node", [
    "-e",
    `import('./packages/platform-cli/dist/index.js').then(({ createProduct }) => createProduct({ targetDir: ${JSON.stringify(target)}, productName: 'Smoke Product' }))`,
  ]);
  mkdirSync(packed, { recursive: true });
  for (const name of packageDirectories) {
    run("pnpm", [
      "--dir",
      path.join(root, "packages", name),
      "pack",
      "--pack-destination",
      packed,
    ]);
  }
  const tarballs = new Map();
  for (const file of readdirSync(packed)) {
    if (!file.endsWith(".tgz")) continue;
    const packageName = [...packageDirectories]
      .sort((a, b) => b.length - a.length)
      .find((name) => file.startsWith(`codelitdev-${name}-`));
    if (packageName) tarballs.set(packageName, path.join(packed, file));
  }
  const packageFiles = [];
  function findPackages(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) findPackages(full);
      else if (entry.name === "package.json") packageFiles.push(full);
    }
  }
  findPackages(target);
  for (const file of packageFiles) {
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    for (const field of ["dependencies", "devDependencies"]) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        if (!name.startsWith("@codelitdev/")) continue;
        const short = name.slice("@codelitdev/".length);
        const tarball = tarballs.get(short);
        if (tarball) pkg[field][name] = `file:${tarball}`;
      }
    }
    writeFileSync(file, `${JSON.stringify(pkg, null, 4)}\n`);
  }
  run("pnpm", ["install", "--lockfile-only", "--ignore-scripts"], target);
  run("pnpm", ["install", "--frozen-lockfile"], target);
  run("pnpm", ["--filter", "*/api", "check:drift"], target);
  if (process.env.DATABASE_URL)
    run("pnpm", ["--filter", "*/api", "migrate"], target);
  run("pnpm", ["test"], target);
  run("pnpm", ["typecheck"], target);
  run("pnpm", ["build"], target);
  run("pnpm", ["lint"], target);
  await smokeHttp();
  await smokeWeb();
  process.stdout.write("template-smoke-ok\n");
} finally {
  rmSync(work, { recursive: true, force: true });
}
