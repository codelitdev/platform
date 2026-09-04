#!/usr/bin/env node
import path from "node:path";
import { runGenerate } from "./generate.js";

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const command =
        args[0] === "generate" || args[0] === "--check" ? "generate" : args[0];
    if (command !== "generate" && command !== undefined) {
        process.stderr.write(
            "usage: codelit-billing generate [--check] [--config <path>]\n",
        );
        process.exitCode = 1;
        return;
    }
    const rest = args[0] === "generate" ? args.slice(1) : args;
    const check = rest.includes("--check");
    const configFlag = rest.indexOf("--config");
    const configPath =
        configFlag >= 0 ? rest[configFlag + 1] : "billing.config.ts";
    try {
        const result = await runGenerate({
            configPath: path.resolve(configPath),
            check,
        });
        if (check) {
            process.stdout.write(`ok ${result.outputPath}\n`);
        } else {
            process.stdout.write(
                `${result.written ? "wrote" : "unchanged"} ${result.outputPath}\n`,
            );
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
    }
}

await main();
