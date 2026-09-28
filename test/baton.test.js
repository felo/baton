import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseClaude } from "../src/claude.js";
import { locate } from "../src/locate.js";
import { parseCodex } from "../src/codex.js";
import { render, stopStatus } from "../src/render.js";
import { fullPatch } from "../src/repo.js";
import { list, save, select } from "../src/store.js";
import { redact } from "../src/util.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => path.join(here, "fixtures", name);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "baton-"));
const kinds = (turns) => turns.map((t) => t.kind);

test("claude: keeps the user's words, drops harness noise and sub-agents", () => {
  const { meta, turns, files } = parseClaude(fixture("claude.jsonl"));
  const user = turns.filter((t) => t.kind === "user").map((t) => t.text);
  assert.deepEqual(user, ["Add a dark mode toggle to settings", "also make it follow the system theme"]);
  assert.equal(meta.title, "Add dark mode");
  assert.equal(meta.cwd, "/work/app");
  assert.deepEqual([...meta.models], ["claude-test-1"]);
  assert.deepEqual(meta.settings, { "Permission mode": ["default"], "Reasoning effort": ["high"] });
  assert.deepEqual([...files], ["/work/app/settings.js"]);
  assert.ok(!turns.some((t) => t.text?.includes("SUBAGENT")));
  assert.ok(kinds(turns).includes("notice"));
});

test("claude: an approved plan is kept whole and marked approved", () => {
  const { turns } = parseClaude(fixture("claude.jsonl"));
  const plan = turns.find((t) => t.kind === "plan");
  assert.equal(plan.approved, true);
  assert.match(plan.text, /Persist choice/);
});

test("claude: a usage limit after the last message reads as out of usage", () => {
  const { turns } = parseClaude(fixture("claude.jsonl"));
  assert.equal(stopStatus(turns).code, "out-of-usage");
});

test("codex: step titles, checklist and edited files; injected context dropped", () => {
  const { meta, turns, files } = parseCodex(fixture("codex.jsonl"));
  assert.deepEqual(kinds(turns), ["user", "thought", "plan", "tool_call", "tool_result", "assistant"]);
  assert.equal(turns[0].text, "Make the jump higher");
  assert.equal(turns[1].text, "Finding jump physics");
  assert.match(turns[2].text, /\[x\] Find jump code\n- \[~\] Raise velocity/);
  assert.deepEqual([...files], ["src/player.ts"]);
  assert.equal(meta.settings.Sandbox[0], "workspace-write");
  assert.equal(stopStatus(turns).code, "finished");
});

test("stop status: mid-task and unanswered", () => {
  assert.equal(stopStatus([{ kind: "user", text: "go" }]).code, "unanswered");
  assert.equal(stopStatus([{ kind: "user", text: "go" }, { kind: "tool_call", name: "Bash", text: "ls" }]).code, "mid-task");
});

test("render: briefing first, sections numbered, secrets redacted", () => {
  const dir = tmp(); // not a git repo, no instruction files
  const parsed = parseClaude(fixture("claude.jsonl"));
  parsed.meta.cwd = dir;
  const { markdown, info } = render({ file: fixture("claude.jsonl"), tool: "claude", ...parsed });
  assert.match(markdown, /^<!-- baton \{/);
  const briefing = markdown.indexOf("## Briefing");
  const convo = markdown.indexOf(". Full conversation\n");
  assert.ok(briefing > 0 && convo > briefing);
  assert.match(markdown, /\*\*It ran out of usage\*\*/);
  assert.match(markdown, /which is your task:\*\*\n\n {2}> also make it follow the system theme/);
  assert.match(markdown, /## 2\. Latest plan\n\nThe user \*\*approved\*\*/);
  assert.ok(!markdown.includes("abcdefghijklmnopqrstuv"));
  assert.equal(info.status, "out-of-usage");
});

test("redact: common key shapes", () => {
  assert.equal(redact("key sk-ant-abcdefghijklmnopqrstuvwxyz1234"), "key [REDACTED]");
  assert.equal(redact("ghp_abcdefghijklmnopqrstuvwxyz0123456789"), "[REDACTED]");
  assert.equal(redact("API_KEY=supersecretvalue123"), "API_KEY=[REDACTED]");
  assert.equal(redact("nothing here"), "nothing here");
});

test("patch: rebuilds the exact working tree on a clean checkout, new files included", () => {
  const repo = tmp();
  const g = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { stdio: "pipe" });
  g(repo, "init", "-q");
  g(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  g(repo, "add", "a.txt");
  g(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "a");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src/new.js"), "export {}\n");

  const { patch, skipped } = fullPatch(repo);
  assert.deepEqual(skipped, []);
  const clone = tmp();
  execFileSync("git", ["clone", "-q", repo, clone]);
  const patchFile = path.join(clone, "..", `p-${Date.now()}.diff`);
  fs.writeFileSync(patchFile, patch);
  g(clone, "apply", patchFile);
  assert.equal(fs.readFileSync(path.join(clone, "a.txt"), "utf8"), "one\ntwo\n");
  assert.equal(fs.readFileSync(path.join(clone, "src/new.js"), "utf8"), "export {}\n");
});

test("store: save, list newest first, select by number and text", () => {
  const dir = tmp();
  const mk = (title, project, created) => save(`<!-- baton ${JSON.stringify({ title, project, created })} -->\n# x\n`, { project, created }, dir);
  mk("Old thing", "api", "2026-01-01T10:00:00.000Z");
  mk("Dark mode", "web", "2026-02-01T10:00:00.000Z");
  const entries = list(dir);
  assert.deepEqual(entries.map((e) => e.title), ["Dark mode", "Old thing"]);
  assert.equal(select(entries).entry.title, "Dark mode");
  assert.equal(select(entries, "2").entry.title, "Old thing");
  assert.equal(select(entries, "API").entry.title, "Old thing");
  assert.equal(select(entries, "2026-01-01").entry.title, "Old thing");
  assert.equal(select(entries, "nope").entry, null);
});

test("locate: finds sessions in the standard ~/.claude and ~/.codex folders by working directory", () => {
  const home = process.env.HOME; // a throwaway folder, see setup.js
  const app = path.join(home, "work/app");
  const game = path.join(home, "work/game");
  const claudeDir = path.join(home, ".claude/projects/-work-app");
  const codexDir = path.join(home, ".codex/sessions/2026/01/02");
  for (const d of [app, game, claudeDir, codexDir]) fs.mkdirSync(d, { recursive: true });
  const copy = (src, dest, from, to) => fs.writeFileSync(dest, fs.readFileSync(fixture(src), "utf8").replaceAll(from, to));
  copy("claude.jsonl", path.join(claudeDir, "abc-123.jsonl"), "/work/app", app);
  copy("codex.jsonl", path.join(codexDir, "rollout-2026-01-02T09-00-00-0199.jsonl"), "/work/game", game);

  assert.equal(locate({ cwd: app }).tool, "claude");
  assert.equal(locate({ cwd: game }).tool, "codex");
  assert.equal(locate({ session: "abc-123" }).tool, "claude");
  assert.throws(() => locate({ cwd: path.join(home, "elsewhere") }), /no Claude Code or Codex session/);
});
