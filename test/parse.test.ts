import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseClaude } from "../src/claude.ts";
import { parseCodex } from "../src/codex.ts";
import { locate } from "../src/locate.ts";
import { fixture } from "./helpers.ts";

const kinds = (turns: { kind: string }[]) => turns.map((t) => t.kind);

test("claude: keeps the user's words, drops harness noise and sub-agents", () => {
  const { meta, turns, files } = parseClaude(fixture("claude.jsonl"));
  const user = turns.flatMap((t) => (t.kind === "user" ? [t.text] : []));
  assert.deepEqual(user, ["Add a dark mode toggle to settings", "also make it follow the system theme"]);
  assert.equal(meta.title, "Add dark mode");
  assert.equal(meta.cwd, "/work/app");
  assert.deepEqual([...meta.models], ["claude-test-1"]);
  assert.deepEqual(meta.settings, { "Permission mode": ["default"], "Reasoning effort": ["high"] });
  assert.deepEqual([...files], ["/work/app/settings.js"]);
  assert.ok(!turns.some((t) => "text" in t && t.text.includes("SUBAGENT")));
  assert.ok(kinds(turns).includes("notice"));
});

test("claude: an approved plan is kept whole and marked approved", () => {
  const { turns } = parseClaude(fixture("claude.jsonl"));
  const plan = turns.find((t) => t.kind === "plan");
  assert.ok(plan && plan.kind === "plan");
  assert.equal(plan.approved, true);
  assert.match(plan.text, /Persist choice/);
});

test("claude: a usage limit is recorded as an error turn", () => {
  const { turns } = parseClaude(fixture("claude.jsonl"));
  const last = turns[turns.length - 1];
  assert.equal(last.kind, "error");
});

test("claude: tolerates a half-written last line", () => {
  const dir = fs.mkdtempSync(path.join(process.env.HOME!, "t-"));
  const file = path.join(dir, "s.jsonl");
  fs.writeFileSync(file, fs.readFileSync(fixture("claude.jsonl"), "utf8") + '{"type":"user","mess');
  assert.doesNotThrow(() => parseClaude(file));
});

test("codex: step titles, checklist and edited files; injected context dropped", () => {
  const { meta, turns, files } = parseCodex(fixture("codex.jsonl"));
  assert.deepEqual(kinds(turns), ["user", "thought", "plan", "tool_call", "tool_result", "assistant"]);
  assert.equal(turns[0].kind === "user" && turns[0].text, "Make the jump higher");
  assert.equal(turns[1].kind === "thought" && turns[1].text, "Finding jump physics");
  assert.match(turns[2].kind === "plan" ? turns[2].text : "", /\[x\] Find jump code\n- \[~\] Raise velocity/);
  assert.deepEqual([...files], ["src/player.ts"]);
  assert.deepEqual(meta.settings.Sandbox, ["workspace-write"]);
  assert.deepEqual(meta.settings.Approvals, ["on-request"]);
  assert.equal(meta.branch, "dev");
});

test("locate: finds sessions in the standard ~/.claude and ~/.codex folders by working directory", () => {
  const home = process.env.HOME!; // a throwaway folder, see setup.ts
  const app = path.join(home, "work/app");
  const game = path.join(home, "work/game");
  const claudeDir = path.join(home, ".claude/projects/-work-app");
  const codexDir = path.join(home, ".codex/sessions/2026/01/02");
  for (const d of [app, game, claudeDir, codexDir]) fs.mkdirSync(d, { recursive: true });
  const copy = (src: string, dest: string, from: string, to: string) => fs.writeFileSync(dest, fs.readFileSync(fixture(src), "utf8").replaceAll(from, to));
  copy("claude.jsonl", path.join(claudeDir, "abc-123.jsonl"), "/work/app", app);
  copy("codex.jsonl", path.join(codexDir, "rollout-2026-01-02T09-00-00-0199.jsonl"), "/work/game", game);

  assert.equal(locate({ cwd: app }).tool, "claude");
  assert.equal(locate({ cwd: game }).tool, "codex");
  assert.equal(locate({ session: "abc-123" }).tool, "claude");
  assert.equal(locate({ session: "0199" }).tool, "codex");
  assert.throws(() => locate({ cwd: app, tool: "codex" }), /no Claude Code or Codex session/);
});

test("locate: says so when there's nothing for this folder", () => {
  assert.throws(() => locate({ cwd: path.join(process.env.HOME!, "elsewhere") }), /no Claude Code or Codex session/);
  assert.throws(() => locate({ session: "does-not-exist" }), /no session found/);
});
