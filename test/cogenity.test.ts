import { test } from "node:test";
import assert from "node:assert/strict";
import { choose, chooseNext, parseStatus, usedOf } from "../src/cogenity.ts";
import type { Account, Status } from "../src/cogenity.ts";

const acct = (email: string, used: number[], extra: Partial<Account> = {}): Account => ({
  email,
  usage: { buckets: used.map((u, i) => ({ name: `b${i}`, utilization: u, resetsAt: `2026-10-0${i + 1}T04:00:00Z` })) },
  ...extra,
});

const status = (claude: Account[], codex: Account[]): Status => ({ schemaVersion: 1, tools: { claude: { accounts: claude }, codex: { accounts: codex } } });

test("usedOf: the tightest real limit; display-only buckets don't count", () => {
  assert.equal(usedOf(acct("a", [10, 80])), 80);
  assert.equal(usedOf({ email: "a", usage: { buckets: [{ name: "x", utilization: 100, displayOnly: true }, { name: "y", utilization: 5 }] } }), 5);
  assert.equal(usedOf({ email: "a", usage: { score: 42 } }), 42);
  assert.equal(usedOf({ email: "a" }), 0);
});

test("choose: Cogenity's own pick wins; otherwise the least used; locked accounts skipped", () => {
  assert.equal(choose(status([acct("a", [10]), acct("b", [90], { wouldPick: true })], []), "claude")?.account, "b");
  assert.equal(choose(status([acct("a", [70]), acct("b", [20])], []), "claude")?.account, "b");
  assert.equal(choose(status([acct("a", [0], { locked: true }), acct("b", [50])], []), "claude")?.account, "b");
  assert.equal(choose(status([], []), "codex"), null);
});

test("choose: an account at 100% is exhausted, with the time it frees up", () => {
  const c = choose(status([acct("a", [100, 30], { wouldPick: true })], []), "claude")!;
  assert.equal(c.exhausted, true);
  assert.equal(c.used, 100);
  assert.equal(c.resetsAt, "2026-10-01T04:00:00Z");
  // Two full limits: usable again only after the later one resets.
  assert.equal(choose(status([acct("a", [100, 100])], []), "claude")!.resetsAt, "2026-10-02T04:00:00Z");
});

test("chooseNext: the tool with the most room; the current tool on a tie", () => {
  const s = status([acct("c", [100])], [acct("x", [20])]);
  assert.equal(chooseNext(s)?.tool, "codex");
  const tie = status([acct("c", [30])], [acct("x", [30])]);
  assert.equal(chooseNext(tie, "claude")?.tool, "claude");
  assert.equal(chooseNext(tie, "codex")?.tool, "codex");
  assert.equal(chooseNext(status([], [])), null);
});

test("parseStatus: accepts Cogenity's versioned JSON, rejects anything else", () => {
  assert.ok(parseStatus(JSON.stringify(status([], []))));
  assert.equal(parseStatus("not json"), null);
  assert.equal(parseStatus(JSON.stringify({ tools: {} })), null, "no schemaVersion");
  assert.equal(parseStatus(JSON.stringify({ schemaVersion: 1 })), null, "no tools");
});
