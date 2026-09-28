import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { hookLine, install, isInstalled, rcFile, shellOf, uninstall } from "../src/setup.ts";
import { root, tmp } from "./helpers.ts";

test("rcFile: the file each shell reads when a terminal opens", () => {
  assert.equal(rcFile("zsh", { home: "/h", env: {} }), "/h/.zshrc");
  assert.equal(rcFile("zsh", { home: "/h", env: { ZDOTDIR: "/z" } }), "/z/.zshrc");
  assert.equal(rcFile("bash", { home: "/h", env: {}, platform: "darwin" }), "/h/.bash_profile");
  assert.equal(rcFile("bash", { home: "/h", env: {}, platform: "linux" }), "/h/.bashrc");
  assert.equal(shellOf({ SHELL: "/bin/zsh" }), "zsh");
  assert.equal(shellOf({ SHELL: "/usr/local/bin/fish" }), null);
});

test("install and uninstall leave the rest of the file exactly as it was", () => {
  const file = path.join(tmp(), ".zshrc");
  const original = "export PATH=$HOME/bin:$PATH\nalias ll='ls -l'\n";
  fs.writeFileSync(file, original);
  install(file, "zsh");
  const text = fs.readFileSync(file, "utf8");
  assert.ok(text.startsWith(original));
  assert.ok(text.endsWith(`${hookLine("zsh")}\n`));
  assert.equal(isInstalled(file), true);
  assert.equal(uninstall(file), true);
  assert.equal(fs.readFileSync(file, "utf8").trimEnd(), original.trimEnd());
  assert.equal(isInstalled(file), false);
  assert.equal(uninstall(file), false, "nothing left to remove");
});

test("install creates the file if there isn't one", () => {
  const file = path.join(tmp(), ".bashrc");
  install(file, "bash");
  assert.match(fs.readFileSync(file, "utf8"), /^# baton: .*\neval "\$\(baton init bash\)"\n$/);
});

function setup(args: string[], { home = tmp(), withBaton = true, shell = "/bin/zsh" } = {}) {
  const bin = tmp();
  if (withBaton) fs.writeFileSync(path.join(bin, "baton"), "#!/bin/sh\n", { mode: 0o755 });
  const r = spawnSync(process.execPath, [path.join(root, "src/cli.ts"), "setup", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, SHELL: shell },
  });
  return { ...r, home, rc: path.join(home, ".zshrc") };
}

test("baton setup: explains, adds with --yes, is idempotent, and --undo removes it", () => {
  const home = tmp();
  const dry = setup([], { home });
  assert.match(dry.stdout, /This adds one line to ~\/\.zshrc:\n\n {2}eval "\$\(baton init zsh\)"/);
  assert.match(dry.stdout, /Run `baton setup --yes` to add it/, "no keyboard, so it doesn't change anything");
  assert.ok(!fs.existsSync(dry.rc));

  assert.match(setup(["--yes"], { home }).stdout, /Added\. Open a new terminal tab/);
  assert.equal(isInstalled(path.join(home, ".zshrc")), true);
  assert.match(setup(["--yes"], { home }).stdout, /Already set up/);
  assert.equal(fs.readFileSync(path.join(home, ".zshrc"), "utf8").match(/baton init/g)!.length, 1);

  assert.match(setup(["--undo"], { home }).stdout, /Removed the baton line/);
  assert.equal(isInstalled(path.join(home, ".zshrc")), false);
});

test("baton setup: needs baton installed, and a supported shell", () => {
  const missing = setup(["--yes"], { withBaton: false });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /npm i -g baton-ai/);
  const fish = setup(["--yes"], { shell: "/usr/bin/fish" });
  assert.equal(fish.status, 1);
  assert.match(fish.stderr, /supports zsh and bash, not fish/);
});
