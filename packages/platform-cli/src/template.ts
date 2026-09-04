import { existsSync } from "node:fs";
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
