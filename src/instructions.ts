import fs from "node:fs";
import path from "node:path";
import { HOME, isDir, isFile } from "./util.ts";

export type InstructionKind = "global" | "project" | "imported" | "memory";

const PROJECT_NAMES = ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md", "AGENTS.md", "AGENTS.override.md"];
const IMPORT_LINE = /^@(\S+)\s*$/gm;

/**
 * The standing instructions and memories the previous agent was loaded with:
 * global files, then project files from the home dir down to cwd, then Claude's
 * per-project memory. Both Claude and Codex files are included whichever tool
 * wrote the transcript, since the next agent may be either.
 * Deduplicated by real path.
 */
export function instructionFiles(cwd: string, transcript?: string): { kind: InstructionKind; file: string }[] {
  const found: { kind: InstructionKind; file: string }[] = [];
  const globals: string[] = [];
  if (process.env.CLAUDE_CONFIG_DIR) globals.push(path.join(process.env.CLAUDE_CONFIG_DIR, "CLAUDE.md"));
  globals.push(path.join(HOME, ".claude/CLAUDE.md"));
  for (const root of [process.env.CODEX_HOME, path.join(HOME, ".codex")]) {
    if (root) globals.push(path.join(root, "AGENTS.md"), path.join(root, "AGENTS.override.md"));
  }
  for (const f of globals) found.push({ kind: "global", file: f });

  // Project files apply from the home dir (exclusive) down to the working directory.
  const chain: string[] = [];
  let dir = path.resolve(cwd);
  while (true) {
    chain.push(dir);
    const parent = path.dirname(dir);
    if (dir === HOME || parent === dir || !dir.startsWith(HOME)) break;
    dir = parent;
  }
  for (const d of chain.reverse()) {
    if (d === HOME) continue;
    for (const n of PROJECT_NAMES) found.push({ kind: "project", file: path.join(d, n) });
  }

  if (transcript) {
    const mem = path.join(path.dirname(transcript), "memory");
    if (isDir(mem)) {
      const files = fs.readdirSync(mem).filter((f) => f.endsWith(".md"));
      files.sort((a, b) => (a === "MEMORY.md" ? -1 : b === "MEMORY.md" ? 1 : a.localeCompare(b)));
      for (const f of files) found.push({ kind: "memory", file: path.join(mem, f) });
    }
  }

  const seen = new Set<string>();
  const result: { kind: InstructionKind; file: string }[] = [];
  const add = (kind: InstructionKind, file: string): boolean => {
    if (!isFile(file)) return false;
    const real = fs.realpathSync(file);
    if (seen.has(real)) return false;
    seen.add(real);
    result.push({ kind, file });
    return true;
  };
  for (const { kind, file } of found) {
    if (!add(kind, file) || kind === "memory") continue;
    // CLAUDE.md can pull in other files with a line like "@path/to/file".
    const text = fs.readFileSync(file, "utf8");
    for (const [, imp] of text.matchAll(IMPORT_LINE)) {
      const target = imp.startsWith("~") ? path.join(HOME, imp.slice(1)) : path.resolve(path.dirname(file), imp);
      add("imported", target);
    }
  }
  return result;
}
