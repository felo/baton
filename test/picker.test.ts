import { test } from "node:test";
import assert from "node:assert/strict";
import { confirm, createPicker, isYes, KEYS, pick, press, view } from "../src/picker.ts";
import type { Terminal } from "../src/terminal.ts";
import { splitKeys } from "../src/terminal.ts";

const items = ["checkout flow", "dark mode", "rate limits", "dark theme"];
const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

/** Feed keys to a picker; returns the result once one of them finishes it. */
function type(p: ReturnType<typeof createPicker<string>>, ...keys: string[]) {
  for (const k of keys) {
    const done = press(p, k);
    if (done) return done.value;
  }
  return undefined;
}

test("picker: enter takes the highlighted row, arrows move", () => {
  assert.equal(type(createPicker(items, String), KEYS.enter), "checkout flow");
  assert.equal(type(createPicker(items, String), KEYS.down, KEYS.down, KEYS.enter), "rate limits");
  assert.equal(type(createPicker(items, String), KEYS.down, KEYS.up, KEYS.up, KEYS.enter), "checkout flow", "stops at the top");
  assert.equal(type(createPicker(items, String), ...Array(10).fill(KEYS.down), KEYS.enter), "dark theme", "stops at the bottom");
});

test("picker: typing filters, backspace widens again", () => {
  const p = createPicker(items, String);
  assert.equal(type(p, ..."dark", KEYS.down, KEYS.enter), "dark theme");
  const q = createPicker(items, String);
  assert.equal(type(q, ..."darkx", KEYS.backspace, KEYS.enter), "dark mode");
});

test("picker: escape and ctrl-c cancel; no matches gives nothing", () => {
  assert.equal(type(createPicker(items, String), KEYS.escape), null);
  assert.equal(type(createPicker(items, String), KEYS.ctrlC), null);
  assert.equal(type(createPicker(items, String), ..."zzz", KEYS.enter), null);
});

test("picker (multi): space toggles, ctrl-a toggles all shown, starts from the checked set", () => {
  const p = createPicker(items, String, { multi: true, checked: ["rate limits"] });
  assert.deepEqual(type(p, KEYS.space, KEYS.enter), ["checkout flow", "rate limits"]);
  const all = createPicker(items, String, { multi: true });
  assert.deepEqual(type(all, KEYS.ctrlA, KEYS.enter), items);
  const none = createPicker(items, String, { multi: true, checked: items });
  assert.deepEqual(type(none, KEYS.ctrlA, KEYS.enter), []);
  const filtered = createPicker(items, String, { multi: true });
  assert.deepEqual(type(filtered, ..."dark", KEYS.ctrlA, KEYS.enter), ["dark mode", "dark theme"]);
});

test("picker view: highlights the cursor, shows checkboxes and scrolls", () => {
  const p = createPicker(items, String, { multi: true, checked: ["dark mode"], visible: 2 });
  let lines = view(p).map(plain);
  assert.equal(lines.length, 4); // title, query, two rows
  assert.match(lines[0], /1 selected/);
  assert.equal(lines[2], "❯ ○ checkout flow");
  assert.equal(lines[3], "  ◉ dark mode");
  press(p, KEYS.down);
  press(p, KEYS.down);
  lines = view(p).map(plain);
  assert.equal(lines[2], "  ◉ dark mode", "scrolled so the cursor stays visible");
  assert.equal(lines[3], "❯ ○ rate limits");
});

test("keys: a chunk of input splits into single keys, escape sequences kept whole", () => {
  assert.deepEqual(splitKeys("dark"), ["d", "a", "r", "k"]);
  assert.deepEqual(splitKeys("n\r"), ["n", "\r"]);
  assert.deepEqual(splitKeys("\x1b[B\x1b[B\r"), ["\x1b[B", "\x1b[B", "\r"]);
  assert.deepEqual(splitKeys("\x1bOA"), ["\x1bOA"]);
  assert.deepEqual(splitKeys("\x1b"), ["\x1b"]);
});

test("confirm: only y or yes counts; enter alone is no", () => {
  assert.equal(isYes("y"), true);
  assert.equal(isYes(" YES "), true);
  assert.equal(isYes(""), false);
  assert.equal(isYes("n"), false);
  assert.equal(isYes("yeah"), false);
});

/** A stand-in terminal driven by a script of keys. */
function fakeTerminal(keys: string[]): Terminal & { screen: string } {
  let handler: ((k: string) => void) | null = null;
  const term = {
    screen: "",
    columns: 80,
    write(s: string) {
      term.screen += s;
    },
    onKey(h: ((k: string) => void) | null) {
      handler = h;
      // Deliver the next keys asynchronously, like a real terminal.
      if (h) setImmediate(() => { while (handler === h && keys.length) h(keys.shift()!); });
    },
    close() {},
  };
  return term;
}

test("pick then confirm on one shared terminal: no keys lost between them", async () => {
  const term = fakeTerminal([KEYS.space, KEYS.enter, "y", KEYS.enter]);
  const chosen = await pick(term, items, String, { multi: true });
  assert.deepEqual(chosen, ["checkout flow"]);
  assert.equal(await confirm(term, "Delete 1 hand-over?"), true);
  assert.match(term.screen, /Delete 1 hand-over\? .*\[y\/N\]/);
});

test("confirm: backspace edits the answer", async () => {
  assert.equal(await confirm(fakeTerminal(["y", KEYS.backspace, "n", KEYS.enter]), "?"), false);
  assert.equal(await confirm(fakeTerminal(["n", KEYS.backspace, "y", KEYS.enter]), "?"), true);
  assert.equal(await confirm(fakeTerminal([KEYS.escape]), "?"), false);
});
