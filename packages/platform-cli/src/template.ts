import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveTemplateDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packed = path.join(here, "..", "template");
  const workspace = path.resolve(here, "../../../templates/saas-product");
  if (existsSync(path.join(workspace, "package.json"))) return workspace;
  if (existsSync(path.join(packed, "package.json"))) return packed;
  throw new Error("template_missing");
}

export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error("product_name_invalid");
  return slug;
}

export function productNameFromTarget(targetDir: string): string {
  const name = path.basename(path.resolve(targetDir));
  if (!name) throw new Error("product_name_invalid");
  return name;
}

/** The CLI release that renders managed files, pinned in the managed workflow. */
export function cliVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(
    readFileSync(path.join(here, "..", "package.json"), "utf8"),
  ) as {
    version: string;
  };
  return pkg.version;
}

/**
 * Files the CLI owns in every product. `sync` rewrites them from the current
 * template; everything else in a product, including `code-quality.yml`, is
 * product-owned after `create`.
 */
export const MANAGED_FILES = [".github/workflows/platform-conformance.yml"] as const;

export type ProductTokens = { name: string; slug: string };

export function templateTokens(product: ProductTokens): Record<string, string> {
  return {
    __PRODUCT_NAME__: product.name,
    __PRODUCT_SLUG__: product.slug,
    __PLATFORM_CLI_VERSION__: cliVersion(),
  };
}

export function renderTemplateFile(rel: string, product: ProductTokens): string {
  let text = readFileSync(path.join(resolveTemplateDir(), rel), "utf8");
  for (const [token, value] of Object.entries(templateTokens(product))) {
    text = text.split(token).join(value);
  }
  return text;
}
