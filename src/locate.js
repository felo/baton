import fs from "node:fs";
import path from "node:path";
import { HOME, isDir, mtime, readJsonlHead } from "./util.js";

/** Every directory that may hold Claude Code transcripts (projects/<slug>/<session>.jsonl). */
export function claudeProjectDirs() {
  const dirs = [];
  if (process.env.CLAUDE_CONFIG_DIR) dirs.push(path.join(process.env.CLAUDE_CONFIG_DIR, "projects"));
  // Cogenity (multi-account launcher) keeps one config dir per account.
  const cogenity = path.join(HOME, ".config/cogenity/claude");
  if (isDir(cogenity)) {
    for (const acct of fs.readdirSync(cogenity)) dirs.push(path.join(cogenity, acct, "projects"));
  }
  dirs.push(path.join(HOME, ".claude/projects"));
  return [...new Set(dirs)].filter(isDir);
}

export function claudeFiles() {
  const files = [];
  for (const dir of claudeProjectDirs()) {
    for (const project of fs.readdirSync(dir)) {
      const p = path.join(dir, project);
      if (!isDir(p)) continue;
      for (const f of fs.readdirSync(p)) if (f.endsWith(".jsonl")) files.push(path.join(p, f));
    }
  }
  return files;
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

export function codexFiles() {
  const roots = [];
  if (process.env.CODEX_HOME) roots.push(path.join(process.env.CODEX_HOME, "sessions"));
  roots.push(path.join(HOME, ".codex/sessions"));
  const files = [];
  for (const r of new Set(roots)) if (isDir(r)) walk(r, files);
  return files;
}

export function toolOf(file) {
  return path.basename(file).startsWith("rollout-") ? "codex" : "claude";
}

export function sessionCwd(file, tool) {
  for (const e of readJsonlHead(file)) {
    if (tool === "claude" && e.cwd) return e.cwd;
    if (tool === "codex" && e.type === "session_meta") return e.payload?.cwd;
  }
  return null;
}

export function findById(id) {
  const claude = claudeFiles().find((f) => path.basename(f) === `${id}.jsonl`);
  if (claude) return { file: claude, tool: "claude" };
  const codex = codexFiles().find((f) => path.basename(f).includes(id));
  if (codex) return { file: codex, tool: "codex" };
  return null;
}

function newestForCwd(files, tool, cwd) {
  const sorted = files.sort((a, b) => mtime(b) - mtime(a)).slice(0, 200);
  return sorted.find((f) => sessionCwd(f, tool) === cwd) || null;
}

/**
 * Pick the session to hand over:
 * an explicit --session, else the session this command runs inside
 * (Claude Code sets CLAUDE_CODE_SESSION_ID for `!` commands), else the
 * most recently active session for the current directory.
 */
export function locate({ session, tool, cwd = process.cwd() }) {
  if (session) {
    if (fs.existsSync(session)) return { file: path.resolve(session), tool: toolOf(session) };
    const found = findById(session);
    if (!found) throw new Error(`no session found with id ${session}`);
    return found;
  }
  if (tool !== "codex" && process.env.CLAUDE_CODE_SESSION_ID) {
    const found = findById(process.env.CLAUDE_CODE_SESSION_ID);
    if (found) return found;
  }
  if (tool !== "claude") {
    for (const v of ["CODEX_THREAD_ID", "CODEX_SESSION_ID"]) {
      if (process.env[v]) {
        const found = findById(process.env[v]);
        if (found) return found;
      }
    }
  }
  const candidates = [];
  if (tool !== "codex") {
    const f = newestForCwd(claudeFiles(), "claude", cwd);
    if (f) candidates.push({ file: f, tool: "claude" });
  }
  if (tool !== "claude") {
    const f = newestForCwd(codexFiles(), "codex", cwd);
    if (f) candidates.push({ file: f, tool: "codex" });
  }
  if (!candidates.length) throw new Error(`no Claude Code or Codex session found for ${cwd}`);
  return candidates.sort((a, b) => mtime(b.file) - mtime(a.file))[0];
}
