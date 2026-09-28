import { test } from "node:test";
import assert from "node:assert/strict";
import { ansi256, canAnimate, colorizer, frame, LOGO, showLogo, TAGLINE } from "../src/logo.ts";

const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

test("logo: every row is the same width", () => {
  assert.ok(LOGO.every((l) => [...l].length === [...LOGO[0]].length));
});

test("logo: the settled frame runs orange to blue and keeps the letters intact", () => {
  const lines = frame(1000, colorizer(true));
  assert.deepEqual(lines.slice(0, LOGO.length).map(plain), LOGO);
  assert.equal(plain(lines[LOGO.length]).trim(), TAGLINE);
  const colours = lines[0].match(/38;2;([0-9;]+)m/g)!;
  assert.equal(colours[0], "38;2;217;119;87m");
  assert.equal(colours[colours.length - 1], "38;2;80;140;255m");
});

test("logo: 256-colour terminals get the nearest palette colour", () => {
  assert.equal(ansi256([0, 0, 0]), 16);
  assert.equal(ansi256([255, 255, 255]), 231);
  assert.match(frame(1000, colorizer(false))[0], /\x1b\[38;5;\d+m/);
});

test("logo: never plays for pipes, agents or NO_COLOR", async () => {
  let written = "";
  const pipe = { isTTY: false, write: (s: string) => (written += s) };
  assert.equal(canAnimate(pipe), false);
  await showLogo(pipe, 0);
  assert.equal(written, "");

  const was = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    assert.equal(canAnimate({ isTTY: true, write: () => true }), false);
  } finally {
    if (was === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = was;
  }
});

test("logo: plays in a terminal and restores the cursor", async () => {
  const saved = { CI: process.env.CI, NO_COLOR: process.env.NO_COLOR, TERM: process.env.TERM };
  delete process.env.CI;
  delete process.env.NO_COLOR;
  process.env.TERM = "xterm-256color";
  try {
    let written = "";
    await showLogo({ isTTY: true, write: (s: string) => (written += s) }, 0);
    assert.ok(written.startsWith("\x1b[?25l"), "hides the cursor while animating");
    assert.ok(written.endsWith("\x1b[?25h"), "and shows it again");
    assert.ok((written.match(/\x1b\[7A/g) || []).length > 10, "draws several frames");
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
