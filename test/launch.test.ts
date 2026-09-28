import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { detectAgent, hookScript, launchCommand, newTabScript, notePath, shellQuote, takeNote, wasYolo, writeNote } from "../src/launch.ts";
import type { ProcessInfo } from "../src/launch.ts";
import { newMeta, note } from "../src/model.ts";
import { root, tmp } from "./helpers.ts";

test("detectAgent: Claude Code's own variables, an explicit override, or the process tree", () => {
  const none: ProcessInfo = () => null;
  assert.deepEqual(detectAgent({ CLAUDECODE: "1", CLAUDE_PID: "4242" }, none), { tool: "claude", pid: 4242 });
  assert.deepEqual(detectAgent({ BATON_AGENT: "codex:77", CLAUDECODE: "1", CLAUDE_PID: "4242" }, none), { tool: "codex", pid: 77 });
  assert.equal(detectAgent({ BATON_AGENT: "none", CLAUDECODE: "1", CLAUDE_PID: "4242" }, none), null);

  // shell (10) → codex (20) → cogenity (30) → login shell (40)
  const tree: Record<number, { ppid: number; command: string }> = {
    10: { ppid: 20, command: "/bin/zsh" },
    20: { ppid: 30, command: "/opt/homebrew/bin/codex" },
    30: { ppid: 40, command: "cogenity" },
    40: { ppid: 1, command: "-zsh" },
  };
  const ps: ProcessInfo = (pid) => tree[pid] ?? null;
  assert.deepEqual(detectAgent({}, ps, 10), { tool: "codex", pid: 20 });
  assert.equal(detectAgent({}, ps, 30), null, "nothing above cogenity");
  assert.equal(detectAgent({}, () => ({ ppid: 1, command: "/Applications/Codex.app/Contents/MacOS/Codex" }), 10), null, "the desktop app isn't the CLI");
});

test("wasYolo: carries over skipped permission prompts from either tool", () => {
  const m = newMeta();
  assert.equal(wasYolo(m), false);
  note(m, "Permission mode", "default");
  note(m, "Permission mode", "bypassPermissions");
  assert.equal(wasYolo(m), true, "the latest setting counts");
  const c = newMeta();
  note(c, "Sandbox", "danger-full-access");
  note(c, "Approvals", "never");
  assert.equal(wasYolo(c), true);
  note(c, "Approvals", "on-request");
  assert.equal(wasYolo(c), false);
});

test("launchCommand: direct or through Cogenity, with or without prompts", () => {
  assert.deepEqual(launchCommand("codex", "go"), ["codex", "go"]);
  assert.deepEqual(launchCommand("claude", "go", { yolo: true }), ["claude", "--dangerously-skip-permissions", "go"]);
  assert.deepEqual(launchCommand("codex", "go", { yolo: true }), ["codex", "--yolo", "go"]);
  assert.deepEqual(launchCommand("codex", "go", { cogenity: true, account: "a@b.c" }), ["cogenity", "--codex", "--account", "a@b.c", "--", "go"]);
  assert.deepEqual(launchCommand("claude", "go", { cogenity: true, yolo: true }), ["cogenity", "--yolo", "--claude", "--", "go"]);
});

test("shellQuote: survives spaces, quotes and $ in a real shell", () => {
  const args = ["printf", "%s|", "it's", 'say "hi"', "$HOME", "a b", "plain-word"];
  const out = execFileSync("sh", ["-c", shellQuote(args)], { encoding: "utf8" });
  assert.equal(out, `it's|say "hi"|$HOME|a b|plain-word|`);
});

test("note: taken once, only while fresh, and never left behind", () => {
  const dir = tmp();
  writeNote(["codex", "go on"], "/work/my app", dir, 1_000_000);
  assert.equal(takeNote(dir, 1_030_000), "cd '/work/my app' && codex 'go on'");
  assert.equal(takeNote(dir, 1_030_000), null, "gone after one use");
  writeNote(["codex"], "/w", dir, 1_000_000);
  assert.equal(takeNote(dir, 1_000_000 + 10 * 60_000), null, "too old");
  assert.ok(!fs.existsSync(notePath(dir)), "a stale note is removed too");
  fs.writeFileSync(notePath(dir), "{broken");
  assert.equal(takeNote(dir), null);
  fs.writeFileSync(notePath(dir), JSON.stringify({ command: "rm -rf /", cwd: "/", created: Date.now() }));
  assert.equal(takeNote(dir), null, "the command must be a list of words");
});

test("newTabScript: Terminal and iTerm get AppleScript, anything else nothing", () => {
  const t = newTabScript("Apple_Terminal", `cd '/a b' && codex "x"`)!;
  assert.match(t[1], /^tell application "Terminal" to do script "cd '\/a b' && codex \\"x\\""$/);
  assert.match(newTabScript("iTerm.app", "codex")![3], /write text "codex"/);
  assert.equal(newTabScript("ghostty", "codex"), null);
  assert.equal(newTabScript(undefined, "codex"), null);
});

test("hookScript: zsh and bash, nothing else", () => {
  assert.match(hookScript("zsh")!, /add-zsh-hook precmd _baton_next/);
  assert.match(hookScript("bash")!, /PROMPT_COMMAND/);
  assert.equal(hookScript("fish"), null);
});

/**
 * The whole hook, in a real shell: a note left by `baton codex` makes the shell
 * start the next agent at its next prompt, once, in the right folder.
 */
for (const shell of ["bash", "zsh"]) {
  const available = spawnSync(shell, ["-c", "exit 0"]).status === 0;
  test(`hook runs the next agent in ${shell}`, { skip: !available && `${shell} not installed` }, () => {
    const bin = tmp();
    const store = tmp();
    const work = tmp();
    const log = path.join(tmp(), "log");
    fs.writeFileSync(path.join(bin, "baton"), `#!/bin/sh\nexec "${process.execPath}" "${path.join(root, "src/cli.ts")}" "$@"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, "codex"), `#!/bin/sh\necho "codex $* in $(pwd -P)" >> "${log}"\n`, { mode: 0o755 });
    const env = { PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: process.env.HOME, BATON_DIR: store };
    const init = execFileSync(process.execPath, [path.join(root, "src/cli.ts"), "init", shell], { encoding: "utf8", env });

    writeNote(["codex", "read it"], work, store);
    // Source the hook, then act like two prompts being drawn.
    const script = `${init}\n_baton_next\n_baton_next\n`;
    const r = spawnSync(shell, ["-c", script], { encoding: "utf8", env, cwd: tmp() });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(log, "utf8"), `codex read it in ${work}\n`, "started once, in the session's folder");
    assert.match(r.stderr, /starting the next agent/);
  });
}
