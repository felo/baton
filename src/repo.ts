import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Untracked files bigger than this are listed by name instead of inlined in the patch.
const UNTRACKED_MAX = 300_000;

function run(cwd: string, args: string[], okCodes = [0]): string {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (err) {
    // `git diff --no-index` exits 1 when files differ, which is the normal case here.
    const e = err as { status?: number; stdout?: unknown };
    if (e.status !== undefined && okCodes.includes(e.status) && typeof e.stdout === "string") return e.stdout;
    return "";
  }
}

export const git = (cwd: string, ...args: string[]): string => run(cwd, args).trimEnd();

export function isRepo(cwd: string): boolean {
  return git(cwd, "rev-parse", "--is-inside-work-tree") === "true";
}

/**
 * Every uncommitted change vs HEAD, new untracked files included, as one
 * patch `git apply` accepts on a clean checkout of HEAD.
 */
export function fullPatch(cwd: string): { patch: string; skipped: string[] } {
  let patch = run(cwd, ["diff", "HEAD"]);
  const skipped: string[] = [];
  for (const f of run(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")) {
    if (!f) continue;
    let size = 0;
    try {
      size = fs.statSync(path.join(cwd, f)).size;
    } catch {
      continue;
    }
    if (size > UNTRACKED_MAX) {
      skipped.push(f);
      continue;
    }
    patch += run(cwd, ["diff", "--no-index", "--", "/dev/null", f], [0, 1]);
  }
  return { patch, skipped };
}

export interface RepoState {
  branch: string;
  remote: string;
  status: string;
  changed: number;
  stat: string;
  base: string;
  log: string;
}

export function repoState(cwd: string): RepoState {
  const status = git(cwd, "status", "--short");
  return {
    branch: git(cwd, "branch", "--show-current") || "(detached)",
    remote: git(cwd, "remote", "get-url", "origin"),
    status,
    changed: status ? status.split("\n").length : 0,
    stat: git(cwd, "diff", "HEAD", "--stat"),
    base: git(cwd, "rev-parse", "HEAD"),
    log: git(cwd, "log", "--oneline", "-10"),
  };
}
