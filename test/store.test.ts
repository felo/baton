import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isOld, keepDays, list, remove, save, select, selectAll } from "../src/store.ts";
import { daysAgo, handover, tmp } from "./helpers.ts";

function sample() {
  const dir = tmp();
  handover(dir, "api-1", { title: "Old thing", project: "api", created: "2026-01-01T10:00:00.000Z" });
  handover(dir, "web-1", { title: "Dark mode", project: "web", created: "2026-02-01T10:00:00.000Z" });
  handover(dir, "api-2", { title: "Rate limits", project: "api", created: "2026-01-15T10:00:00.000Z" });
  return { dir, entries: list(dir) };
}

test("list: newest first, from the metadata line", () => {
  const { entries } = sample();
  assert.deepEqual(entries.map((e) => e.title), ["Dark mode", "Rate limits", "Old thing"]);
});

test("list: tolerates files that aren't hand-overs, and a missing folder", () => {
  const dir = tmp();
  fs.writeFileSync(`${dir}/notes.md`, "just notes");
  assert.equal(list(dir)[0].title, "notes");
  assert.deepEqual(list(`${dir}/nope`), []);
});

test("select: latest, by number, by text, by date", () => {
  const { entries } = sample();
  assert.equal(select(entries).entry?.title, "Dark mode");
  assert.equal(select(entries, "3").entry?.title, "Old thing");
  assert.equal(select(entries, "API").entry?.title, "Rate limits", "newest match wins");
  assert.equal(select(entries, "API").matches, 2);
  assert.equal(select(entries, "2026-01-01").entry?.title, "Old thing");
  assert.equal(select(entries, "nope").entry, null);
  assert.equal(select(entries, "99").entry, null, "an out-of-range number is text, and matches nothing");
});

test("selectAll: every match, for cleaning", () => {
  const { entries } = sample();
  assert.equal(selectAll(entries, "api").length, 2);
  assert.equal(selectAll(entries, "1")[0].title, "Dark mode");
});

test("save: file named after the project and time, never overwriting", () => {
  const dir = tmp();
  const info = { project: "My App!", created: "2026-03-04T05:06:07.000Z" };
  const a = save("a", info, dir);
  const b = save("b", info, dir);
  assert.match(a, /my-app-20260304-050607\.md$/);
  assert.match(b, /my-app-20260304-050607-2\.md$/);
});

test("keep days: 30 by default, configurable, 0 means forever", () => {
  const was = process.env.BATON_KEEP_DAYS;
  try {
    delete process.env.BATON_KEEP_DAYS;
    assert.equal(keepDays(), 30);
    process.env.BATON_KEEP_DAYS = "7";
    assert.equal(keepDays(), 7);
    process.env.BATON_KEEP_DAYS = "nonsense";
    assert.equal(keepDays(), 30);
  } finally {
    if (was === undefined) delete process.env.BATON_KEEP_DAYS;
    else process.env.BATON_KEEP_DAYS = was;
  }
  const entry = { file: "x", title: "x", created: daysAgo(40) };
  assert.equal(isOld(entry, 30), true);
  assert.equal(isOld(entry, 60), false);
  assert.equal(isOld(entry, 0), false, "0 keeps forever");
});

test("remove: deletes and counts, ignoring files already gone", () => {
  const { dir, entries } = sample();
  assert.equal(remove([entries[0], entries[0]]), 1);
  assert.equal(list(dir).length, 2);
});
