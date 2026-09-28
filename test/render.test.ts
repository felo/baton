import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseClaude } from "../src/claude.ts";
import type { Turn } from "../src/model.ts";
import { render, stopStatus } from "../src/render.ts";
import { fullPatch } from "../src/repo.ts";
import { redact } from "../src/util.ts";
import { fixture, tmp } from "./helpers.ts";

test("stop status: each way a session can end", () => {
  const user: Turn = { kind: "user", text: "go" };
  assert.equal(stopStatus([user]).code, "unanswered");
  assert.equal(stopStatus([user, { kind: "tool_call", name: "Bash", text: "ls" }]).code, "mid-task");
  assert.equal(stopStatus([user, { kind: "assistant", text: "done" }]).code, "finished");
  assert.equal(stopStatus([user, { kind: "assistant", text: "done" }, { kind: "thought", text: "x" }]).code, "finished");
  assert.equal(stopStatus([user, { kind: "error", text: "You've hit your session limit", code: "rate_limit" }]).code, "out-of-usage");
  assert.equal(stopStatus([user, { kind: "error", text: "Can't reach the API server", code: null }]).code, "error");
  // An error before the user's last message doesn't count.
  assert.equal(stopStatus([{ kind: "error", text: "limit", code: null }, user, { kind: "assistant", text: "ok" }]).code, "finished");
});

test("render: briefing first, sections numbered in reading order", () => {
  const parsed = parseClaude(fixture("claude.jsonl"));
  parsed.meta.cwd = tmp(); // not a git repo, no instruction files
  const { markdown, info } = render({ file: fixture("claude.jsonl"), tool: "claude", ...parsed });
  assert.match(markdown, /^<!-- baton \{/);
  const headings = markdown.split("\n").filter((l) => l.startsWith("## "));
  assert.deepEqual(headings, ["## Briefing", "## 1. Session", "## 2. Latest plan", "## 3. Files the previous agent edited", "## 4. Full conversation"]);
  assert.match(markdown, /\*\*It ran out of usage\*\*/);
  assert.match(markdown, /which is your task:\*\*\n\n {2}> also make it follow the system theme/);
  assert.match(markdown, /## 2\. Latest plan\n\nThe user \*\*approved\*\*/);
  assert.match(markdown, /- \*\*Permission mode:\*\* default/);
  assert.equal(info.status, "out-of-usage");
  assert.equal(info.title, "Add dark mode");
  assert.equal(info.userMessages, 2);
});

test("render: secrets in tool output are redacted", () => {
  const parsed = parseClaude(fixture("claude.jsonl"));
  parsed.meta.cwd = tmp();
  const { markdown } = render({ file: fixture("claude.jsonl"), tool: "claude", ...parsed });
  assert.ok(!markdown.includes("abcdefghijklmnopqrstuv"));
  assert.match(markdown, /token=\[REDACTED\]/);
});

test("render: includes the user's instruction files and says to follow them", () => {
  const cwd = path.join(process.env.HOME!, "proj");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, "AGENTS.md"), "Always write tests.");
  const parsed = parseClaude(fixture("claude.jsonl"));
  parsed.meta.cwd = cwd;
  const { markdown } = render({ file: fixture("claude.jsonl"), tool: "claude", ...parsed });
  assert.match(markdown, /## 1\. Standing instructions and memory/);
  assert.match(markdown, /Always write tests\./);
  assert.match(markdown, /Follow the user's standing instructions \(section 1\)/);
});

test("render: long tool output is cut unless --full", () => {
  const parsed = parseClaude(fixture("claude.jsonl"));
  parsed.meta.cwd = tmp();
  parsed.turns.push({ kind: "tool_result", text: "x".repeat(5000), error: false });
  const short = render({ file: "f", tool: "claude", ...parsed }).markdown;
  const full = render({ file: "f", tool: "claude", ...parsed }, { full: true }).markdown;
  assert.match(short, /more characters cut/);
  assert.ok(full.includes("x".repeat(5000)));
});

test("redact: common key shapes", () => {
  assert.equal(redact("key sk-ant-abcdefghijklmnopqrstuvwxyz1234"), "key [REDACTED]");
  assert.equal(redact("ghp_abcdefghijklmnopqrstuvwxyz0123456789"), "[REDACTED]");
  assert.equal(redact("AKIAABCDEFGHIJKLMNOP"), "[REDACTED]");
  assert.equal(redact("API_KEY=supersecretvalue123"), "API_KEY=[REDACTED]");
  assert.equal(redact("nothing here"), "nothing here");
});

const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { stdio: "pipe" });

test("patch: rebuilds the exact working tree on a clean checkout, new files included", () => {
  const repo = tmp();
  git(repo, "init", "-q");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  git(repo, "add", "a.txt");
  git(repo, "commit", "-q", "-m", "a");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src/new.js"), "export {}\n");

  const { patch, skipped } = fullPatch(repo);
  assert.deepEqual(skipped, []);
  const clone = tmp();
  execFileSync("git", ["clone", "-q", repo, clone]);
  const patchFile = path.join(tmp(), "p.diff");
  fs.writeFileSync(patchFile, patch);
  git(clone, "apply", patchFile);
  assert.equal(fs.readFileSync(path.join(clone, "a.txt"), "utf8"), "one\ntwo\n");
  assert.equal(fs.readFileSync(path.join(clone, "src/new.js"), "utf8"), "export {}\n");
});

test("patch: very large new files are listed instead of inlined", () => {
  const repo = tmp();
  git(repo, "init", "-q");
  git(repo, "commit", "-q", "--allow-empty", "-m", "base");
  fs.writeFileSync(path.join(repo, "big.bin"), Buffer.alloc(400_000, 1));
  assert.deepEqual(fullPatch(repo).skipped, ["big.bin"]);
});
