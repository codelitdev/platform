#!/usr/bin/env node
import { createProduct } from "./create.js";
import { doctor } from "./doctor.js";
import { upgradeProduct } from "./upgrade.js";

const [command, ...rest] = process.argv.slice(2);

try {
  if (command === "create") {
    const name = rest[0];
    if (!name) throw new Error("usage: codelit-platform create <dir>");
    const result = createProduct({
      targetDir: name,
      productName: name,
    });
    process.stdout.write(`created ${result.root}\n`);
  } else if (command === "doctor") {
    const report = doctor(process.cwd());
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (!report.ok) process.exitCode = 1;
  } else if (command === "upgrade") {
    const dryRun = rest.includes("--dry-run");
    const version = rest.find((arg) => !arg.startsWith("--"));
    const result = upgradeProduct({
      root: process.cwd(),
      version,
      dryRun,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.conflicts.length > 0) process.exitCode = 1;
  } else {
    process.stderr.write("usage: codelit-platform create|doctor|upgrade\n");
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
