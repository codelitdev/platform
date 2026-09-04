import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { type BillingConfig, validateBillingConfig } from "../config/validate.js";
import { renderGeneratedSchema } from "../schema/generator.js";

function unwrapDefaultExport(mod: unknown): BillingConfig | null {
  let current: unknown = mod;
  for (let i = 0; i < 4; i += 1) {
    if (
      current &&
      typeof current === "object" &&
      "dialect" in current &&
      "adapter" in current
    ) {
      return current as BillingConfig;
    }
    if (
      current &&
      typeof current === "object" &&
      "default" in current &&
      (current as { default: unknown }).default !== undefined
    ) {
      current = (current as { default: unknown }).default;
      continue;
    }
    break;
  }
  return null;
}

export type GenerateOptions = {
  configPath: string;
  check?: boolean;
  cwd?: string;
};

export async function loadBillingConfigFile(
  configPath: string,
): Promise<BillingConfig> {
  const url = pathToFileURL(configPath).href;
  const mod = (await import(url)) as { default?: unknown };
  const config = unwrapDefaultExport(mod);
  if (!config) {
    throw new Error("billing_config_default_export_missing");
  }
  return validateBillingConfig(config);
}

export function schemaFingerprint(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

export async function runGenerate(options: GenerateOptions): Promise<{
  outputPath: string;
  source: string;
  drifted: boolean;
  written: boolean;
}> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = path.resolve(cwd, options.configPath);
  const config = await loadBillingConfigFile(configPath);
  const source = renderGeneratedSchema(config);
  const outputPath = path.resolve(path.dirname(configPath), config.output);
  let existing: string | null;
  try {
    existing = await readFile(outputPath, "utf8");
  } catch {
    existing = null;
  }
  const drifted = existing !== source;
  if (options.check) {
    if (drifted) {
      const error = new Error("billing_schema_drift");
      (error as Error & { code: string }).code = "billing_schema_drift";
      throw error;
    }
    return { outputPath, source, drifted: false, written: false };
  }
  if (drifted) {
    await writeFile(outputPath, source, "utf8");
  }
  return { outputPath, source, drifted, written: drifted };
}
