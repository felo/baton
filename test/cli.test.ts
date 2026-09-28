// End to end: run the real command the way a user or an agent would, with no
// terminal attached (so no pickers or prompts), against throwaway folders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { daysAgo, fixture, handover, root, tmp } from "./helpers.ts";

const CLI = path.join(root, "src/cli.ts");

function baton(args: string[], { dir = tmp(), cwd = tmp(), env = {} }: { dir?: string; cwd?: string; env?: Record<string, string> } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    // Never find a real agent or a real Cogenity from inside the test run.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BATON_DIR: dir, BATON_AGENT: "none", BATON_NO_COGENITY: "1", ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr, dir };
}

test("--help and --version; no logo when output isn't a terminal", () => {
  const help = baton(["--help"]);
  assert.equal(help.code, 0);
  assert.ok(help.out.startsWith("baton "), "starts with the name, not logo escape codes");
  for (const cmd of ["baton take", "baton list", "baton clean", "baton flush", "BATON_KEEP_DAYS"]) assert.ok(help.out.includes(cmd), cmd);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(baton(["--version"]).out.trim(), pkg.version);
});

test("save a session, then list and take it", () => {
  const dir = tmp();
  const saved = baton(["--session", fixture("claude.jsonl"), "--no-diff"], { dir });
  assert.equal(saved.code, 0, saved.err);
  assert.match(saved.out, /^Saved .*app-\d{8}-\d{6}\.md/);
  assert.match(saved.out, /Claude Code · ran out of usage · 2 messages from you/);
  assert.match(saved.out, /claude "\$\(baton take\)"/);
  const [file] = fs.readdirSync(dir);
  assert.match(fs.readFileSync(path.join(dir, file), "utf8"), /## Briefing/);

  assert.match(baton(["list"], { dir }).out, /^ 1 {2}\d{4}-\d\d-\d\d \d\d:\d\d {2}app .*Add dark mode {2}· ran out of usage/);
  const take = baton(["take"], { dir });
  assert.equal(take.out.trim(), `Read the hand-over at ${path.join(dir, file)}. Another AI agent wrote it when it had to stop. Start with its Briefing section, then continue the work.`);
  assert.match(take.err, /Add dark mode/, "says which one it took, on stderr");
  assert.equal(baton(["take", "--path"], { dir }).out.trim(), path.join(dir, file));
  assert.match(baton(["take", "--content"], { dir }).out, /^<!-- baton /);
});

test("save a Codex session", () => {
  const r = baton(["--session", fixture("codex.jsonl"), "--no-diff"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Codex · finished · 1 message from you/);
});

test("--stdout prints instead of saving; --out saves elsewhere", () => {
  const dir = tmp();
  const printed = baton(["--session", fixture("claude.jsonl"), "--stdout"], { dir });
  assert.match(printed.out, /^<!-- baton /);
  assert.deepEqual(fs.existsSync(dir) ? fs.readdirSync(dir) : [], []);
  const elsewhere = tmp();
  const r = baton(["--session", fixture("claude.jsonl"), "--out", elsewhere], { dir });
  assert.equal(fs.readdirSync(elsewhere).length, 1);
  assert.match(r.out, /Read the hand-over at /, "prints the ready prompt for a custom folder");
});

test("take: by number, by text, and a clear error when nothing matches", () => {
  const dir = tmp();
  handover(dir, "a", { title: "Checkout flow", project: "shop", created: daysAgo(3) });
  handover(dir, "b", { title: "Dark mode", project: "web", created: daysAgo(1) });
  assert.match(baton(["take", "2", "--path"], { dir }).out, /a\.md/);
  assert.match(baton(["take", "checkout", "--path"], { dir }).out, /a\.md/);
  assert.match(baton(["take", "--latest", "--path"], { dir }).out, /b\.md/);
  const none = baton(["take", "nothing-like-this"], { dir });
  assert.equal(none.code, 1);
  assert.match(none.err, /nothing matches "nothing-like-this"/);
});

test("pick without a terminal explains what to do instead", () => {
  const dir = tmp();
  handover(dir, "a", { title: "A", project: "p", created: daysAgo(1) });
  const r = baton(["pick"], { dir });
  assert.equal(r.code, 1);
  assert.match(r.err, /needs an interactive terminal/);
});

test("empty store: take and list say how to start; clean has nothing to do", () => {
  const r = baton(["take"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /no hand-overs saved .* yet/);
  assert.equal(baton(["clean"]).out.trim(), "Nothing to clean up.");
});

test("clean: without a terminal it only lists, and --yes deletes the old ones", () => {
  const dir = tmp();
  handover(dir, "old", { title: "Old", project: "p", created: daysAgo(45) });
  handover(dir, "new", { title: "New", project: "p", created: daysAgo(2) });
  const dry = baton(["clean"], { dir });
  assert.match(dry.out, /Old/);
  assert.doesNotMatch(dry.out, /New/);
  assert.match(dry.out, /Run again with --yes to delete it\./);
  assert.equal(fs.readdirSync(dir).length, 2, "nothing deleted without --yes");

  assert.equal(baton(["clean", "--yes"], { dir }).out.trim(), "Deleted 1 hand-over.");
  assert.deepEqual(fs.readdirSync(dir), ["new.md"]);
});

test("clean <which> and flush", () => {
  const dir = tmp();
  handover(dir, "a", { title: "Checkout", project: "shop", created: daysAgo(1) });
  handover(dir, "b", { title: "Dark mode", project: "web", created: daysAgo(2) });
  handover(dir, "c", { title: "Checkout v2", project: "shop", created: daysAgo(3) });
  assert.equal(baton(["clean", "shop", "--yes"], { dir }).out.trim(), "Deleted 2 hand-overs.");
  assert.equal(baton(["clean", "nope", "--yes"], { dir }).code, 1);

  const dry = baton(["flush"], { dir });
  assert.match(dry.out, /Run again with --yes/);
  assert.equal(fs.readdirSync(dir).length, 1);
  assert.equal(baton(["flush", "--yes"], { dir }).out.trim(), "Deleted 1 hand-over.");
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("clean with automatic cleanup turned off", () => {
  const dir = tmp();
  handover(dir, "old", { title: "Old", project: "p", created: daysAgo(400) });
  const r = baton(["clean"], { dir, env: { BATON_KEEP_DAYS: "0" } });
  assert.match(r.out, /Automatic cleanup is off/);
});

test("saving cleans up hand-overs older than the keep period, only in baton's own folder", () => {
  const dir = tmp();
  handover(dir, "ancient", { title: "Ancient", project: "p", created: daysAgo(60) });
  handover(dir, "recent", { title: "Recent", project: "p", created: daysAgo(5) });
  const r = baton(["--session", fixture("codex.jsonl"), "--no-diff"], { dir });
  assert.match(r.out, /Cleaned up 1 hand-over older than 30 days\./);
  assert.ok(!fs.existsSync(path.join(dir, "ancient.md")));
  assert.ok(fs.existsSync(path.join(dir, "recent.md")));

  const other = tmp();
  handover(other, "ancient", { title: "Ancient", project: "p", created: daysAgo(60) });
  baton(["--session", fixture("codex.jsonl"), "--no-diff", "--out", other], { dir });
  assert.ok(fs.existsSync(path.join(other, "ancient.md")), "--out folders are never cleaned");

  handover(dir, "ancient2", { title: "Ancient", project: "p", created: daysAgo(60) });
  baton(["--session", fixture("codex.jsonl"), "--no-diff"], { dir, env: { BATON_KEEP_DAYS: "0" } });
  assert.ok(fs.existsSync(path.join(dir, "ancient2.md")), "BATON_KEEP_DAYS=0 keeps everything");
});

test("bad input gets a clear error", () => {
  assert.match(baton(["--tool", "gemini"]).err, /--tool must be claude or codex/);
  assert.match(baton(["--session", "no-such-session"]).err, /no session found/);
  const nothing = baton([], { cwd: tmp() });
  assert.equal(nothing.code, 1);
  assert.match(nothing.err, /no Claude Code or Codex session found/);
});
