// Fails when the design system's built shadcn registry (`public/r/*.json`) is out
// of step with its sources, or when a registry file would install outside the
// app's `ui/codelit/` folder. Fix drift with
// `bun run --filter @codelitdev/design-system registry:build` and commit the result.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packageDir = path.join(root, "packages/design-system");
const committedDir = path.join(packageDir, "public/r");
const problems = [];

const registry = JSON.parse(
  readFileSync(path.join(packageDir, "registry.json"), "utf8"),
);
for (const item of registry.items) {
  for (const file of item.files) {
    if (!file.target?.startsWith("@ui/codelit/")) {
      problems.push(`registry_target_missing:${item.name}:${file.path}`);
    }
  }
}

const builtDir = mkdtempSync(path.join(tmpdir(), "codelit-registry-"));
try {
  execFileSync("bun", ["x", "shadcn", "build", "--output", builtDir], {
    cwd: packageDir,
    stdio: "pipe",
  });
  const built = new Set(readdirSync(builtDir));
  const committed = new Set(readdirSync(committedDir));
  for (const name of new Set([...built, ...committed])) {
    if (!committed.has(name)) problems.push(`registry_build_missing:${name}`);
    else if (!built.has(name)) problems.push(`registry_build_extra:${name}`);
    else if (
      readFileSync(path.join(builtDir, name), "utf8") !==
      readFileSync(path.join(committedDir, name), "utf8")
    ) {
      problems.push(`registry_build_stale:${name}`);
    }
  }
} finally {
  rmSync(builtDir, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(
    "Run `bun run --filter @codelitdev/design-system registry:build` and commit public/r.",
  );
  process.exit(1);
}
console.log(`registry ok: ${registry.items.length} items`);
