import { execFileSync } from "node:child_process";

export function assertGitClean(cwd: string): void {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      stdio: "pipe",
    });
  } catch {
    throw new Error("sync_requires_git_repository");
  }
  const status = execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
  });
  if (status.trim().length > 0) {
    throw new Error("sync_requires_clean_worktree");
  }
}
