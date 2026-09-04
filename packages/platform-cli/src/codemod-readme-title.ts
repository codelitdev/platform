import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const TARGET = path.join("apps", "api", "README.md");

export const README_TITLE_CODEMOD = "set-api-readme-title";

export function applyReadmeTitleCodemod(
  root: string,
  productName: string,
): { changed: boolean; path: string } {
  const file = path.join(root, TARGET);
  if (!existsSync(file)) throw new Error("codemod_input_unsupported");
  const current = readFileSync(file, "utf8");
  const nextTitle = `# ${productName} API`;
  const lines = current.split("\n");
  if (lines[0] === nextTitle) {
    return { changed: false, path: TARGET };
  }
  if (!lines[0]?.startsWith("# ")) {
    throw new Error("codemod_input_unsupported");
  }
  lines[0] = nextTitle;
  writeFileSync(file, lines.join("\n"));
  return { changed: true, path: TARGET };
}
