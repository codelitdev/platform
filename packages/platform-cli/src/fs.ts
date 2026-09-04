import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export function isEmptyDir(dir: string): boolean {
  if (!existsSync(dir)) return true;
  return readdirSync(dir).length === 0;
}

export function listFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".git") continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(path.relative(root, full));
    }
  }
  walk(root);
  return out.sort();
}

export function replaceTokens(
  root: string,
  tokens: Record<string, string>,
): void {
  for (const rel of listFiles(root)) {
    const full = path.join(root, rel);
    const text = readFileSync(full, "utf8");
    let next = text;
    for (const [token, value] of Object.entries(tokens)) {
      next = next.split(token).join(value);
    }
    if (next !== text) writeFileSync(full, next);
  }
}

export function copyTemplate(from: string, to: string): void {
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
