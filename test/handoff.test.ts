// `baton claude|codex|next` end to end, with stand-in claude, codex and
// cogenity programs that record how they were started. No real agent or
// account is ever touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Account, Status } from "../src/cogenity.ts";
import { notePath, takeNote } from "../src/launch.ts";
import { fixture, root, tmp } from "./helpers.ts";

const CLI = path.join(root, "src/cli.ts");

interface Call {
  bin: string;
  args: string[];
  cwd: string;
}

/** A folder of fake programs. Each appends {bin, args, cwd} to the log; `cogenity status --json` prints `status`. */
function fakes(status?: Status) {
  const bin = tmp();
  const log = path.join(tmp(), "calls.jsonl");
  const statusFile = path.join(tmp(), "status.json");
  if (status) fs.writeFileSync(statusFile, JSON.stringify(status));
  const record = (name: string) =>
    `#!${process.execPath}\n` +
    `const [a, b] = process.argv.slice(2);\n` +
    (name === "cogenity" ? `if (a === "status" && b === "--json") { process.stdout.write(require("fs").readFileSync(${JSON.stringify(statusFile)}, "utf8")); process.exit(0); }\nif (a === "--version") { console.log("0.0.0"); process.exit(0); }\n` : "") +
    `require("fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify({ bin: ${JSON.stringify(name)}, args: process.argv.slice(2), cwd: process.cwd() }) + "\\n");\n`;
  for (const name of ["claude", "codex", ...(status ? ["cogenity"] : [])]) fs.writeFileSync(path.join(bin, name), record(name), { mode: 0o755 });
  const calls = (): Call[] => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { bin, calls };
}

function baton(args: string[], { bin, dir = tmp(), cwd = tmp(), env = {} }: { bin: string; dir?: string; cwd?: string; env?: Record<string, string> }) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--session", fixture("claude.jsonl"), "--no-diff"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: process.env.HOME, BATON_DIR: dir, BATON_AGENT: "none", TERM_PROGRAM: "", ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr, dir, cwd };
}

const acct = (email: string, used: number, extra: Partial<Account> = {}): Account => ({
  email,
  usage: { buckets: [{ name: "week", utilization: used, resetsAt: "2026-10-01T02:00:00Z" }] },
  ...extra,
});
const status = (claude: Account[], codex: Account[]): Status => ({ schemaVersion: 1, tools: { claude: { accounts: claude }, codex: { accounts: codex } } });

test("from a terminal, without Cogenity: saves, then starts the agent right here on the hand-over", () => {
  const f = fakes();
  const r = baton(["codex"], { bin: f.bin });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Saved /);
  assert.match(r.out, /Starting Codex…/);
  const [call] = f.calls();
  assert.equal(call.bin, "codex");
  assert.equal(call.args.length, 1);
  assert.match(call.args[0], /^Read the hand-over at .*\.md\. .*Briefing/);
  assert.ok(fs.existsSync(call.args[0].match(/at (.*\.md)\./)![1]), "the prompt points at the saved file");
  assert.equal(fs.realpathSync(call.cwd), r.cwd);
});

test("with Cogenity: starts through it on the account it would pick", () => {
  const f = fakes(status([acct("c1@x", 40, { wouldPick: true })], [acct("x1@x", 90), acct("x2@x", 10, { wouldPick: true })]));
  const r = baton(["codex"], { bin: f.bin });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Starting Codex on x2@x \(10% used\) via Cogenity…/);
  const [call] = f.calls();
  assert.equal(call.bin, "cogenity");
  assert.deepEqual(call.args.slice(0, 4), ["--codex", "--account", "x2@x", "--"]);
  assert.match(call.args[4], /^Read the hand-over at /);
});

test("--account and --yolo are passed on", () => {
  const f = fakes(status([acct("c1@x", 0)], []));
  baton(["claude", "--account", "me@x", "--yolo"], { bin: f.bin });
  assert.deepEqual(f.calls()[0].args.slice(0, 5), ["--yolo", "--claude", "--account", "me@x", "--"]);
});

test("next: picks the tool with the most room", () => {
  const f = fakes(status([acct("c1@x", 100, { wouldPick: true })], [acct("x1@x", 20, { wouldPick: true })]));
  const r = baton(["next"], { bin: f.bin });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(f.calls()[0].args.slice(0, 3), ["--codex", "--account", "x1@x"]);
});

test("next without Cogenity, outside an agent, explains itself", () => {
  const f = fakes();
  const r = baton(["next"], { bin: f.bin, env: { BATON_NO_COGENITY: "1" } });
  assert.equal(r.code, 1);
  assert.match(r.err, /needs Cogenity/);
  assert.deepEqual(f.calls(), []);
});

test("a used-up tool: without a keyboard, stops and suggests the one with room; nothing is started", () => {
  const f = fakes(status([acct("c1@x", 100, { wouldPick: true })], [acct("x1@x", 5, { wouldPick: true })]));
  const r = baton(["claude"], { bin: f.bin });
  assert.equal(r.code, 1);
  assert.match(r.err, /Every Claude Code account is used up .*Use `baton codex` or `baton next` instead/);
  assert.deepEqual(f.calls(), []);
  assert.deepEqual(fs.existsSync(r.dir) ? fs.readdirSync(r.dir) : [], [], "and nothing saved");
});

test("--account overrides the used-up check", () => {
  const f = fakes(status([acct("c1@x", 100, { wouldPick: true })], []));
  const r = baton(["claude", "--account", "c1@x"], { bin: f.bin });
  assert.equal(r.code, 0, r.err);
  assert.equal(f.calls()[0].bin, "cogenity");
});

test("--dry-run shows the command and changes nothing", () => {
  const f = fakes(status([], [acct("x1@x", 0, { wouldPick: true })]));
  const r = baton(["codex", "--dry-run"], { bin: f.bin });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Would start Codex on x1@x \(0% used\) via Cogenity:\n {2}cd .* && cogenity --codex --account x1@x -- 'Read the hand-over at /);
  assert.deepEqual(f.calls(), []);
});

test("inside an agent with the shell hook: leaves a note for the shell and closes the agent", async () => {
  const f = fakes();
  // A stand-in for the running agent: a process we're allowed to close.
  const agent = spawn("sleep", ["30"], { stdio: "ignore" });
  const exited = new Promise<string | null>((resolve) => agent.on("exit", (_code, signal) => resolve(signal)));
  const r = baton(["codex"], { bin: f.bin, env: { BATON_AGENT: `claude:${agent.pid}`, BATON_HOOK: "zsh", BATON_NO_COGENITY: "1" } });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Closing Claude Code\. Codex starts in this window in a moment\./);
  assert.equal(await exited, "SIGTERM");
  assert.deepEqual(f.calls(), [], "the shell starts it, not baton");
  const line = takeNote(r.dir);
  assert.match(line!, /^cd .* && codex 'Read the hand-over at /);
});

test("inside an agent without the hook: prints the command and how to set the hook up; the agent stays", () => {
  const f = fakes();
  const agent = spawn("sleep", ["30"], { stdio: "ignore" });
  try {
    const r = baton(["codex"], { bin: f.bin, env: { BATON_AGENT: `claude:${agent.pid}`, BATON_NO_COGENITY: "1" } });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Start Codex with:\n {2}cd .* && codex 'Read the hand-over at /);
    assert.match(r.out, /eval "\$\(baton init zsh\)"/);
    assert.equal(agent.exitCode, null, "still running");
    assert.ok(!fs.existsSync(notePath(r.dir)));
  } finally {
    agent.kill();
  }
});

test("init: prints the hook for the shell asked for, or explains", () => {
  const f = fakes();
  const zsh = spawnSync(process.execPath, [CLI, "init", "zsh"], { encoding: "utf8" });
  assert.match(zsh.stdout, /add-zsh-hook precmd _baton_next/);
  const fish = spawnSync(process.execPath, [CLI, "init", "fish"], { encoding: "utf8" });
  assert.equal(fish.status, 1);
  assert.match(fish.stderr, /Supported: zsh, bash/);
  assert.ok(f);
});
