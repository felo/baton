// `baton setup`: add (or remove) the one line that lets `! baton codex` continue
// in the same window, so nobody has to edit their shell config by hand.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { HOME } from "./util.ts";

export type Shell = "zsh" | "bash";

const MARK = "# baton: continue in the same window after `! baton codex` (https://github.com/felo/baton)";

export const hookLine = (shell: Shell): string => `eval "$(baton init ${shell})"`;

export function shellOf(env: NodeJS.ProcessEnv = process.env): Shell | null {
  const name = path.basename(env.SHELL || "");
  return name === "zsh" || name === "bash" ? name : null;
}

/** The file each shell reads when a terminal opens. Terminals on macOS start bash as a login shell. */
export function rcFile(shell: Shell, { home = HOME, env = process.env, platform = process.platform } = {}): string {
  if (shell === "zsh") return path.join(env.ZDOTDIR || home, ".zshrc");
  return path.join(home, platform === "darwin" ? ".bash_profile" : ".bashrc");
}

export function isInstalled(file: string): boolean {
  try {
    return /baton init (zsh|bash)/.test(fs.readFileSync(file, "utf8"));
  } catch {
    return false;
  }
}

export function install(file: string, shell: Shell): void {
  let before = "";
  try {
    before = fs.readFileSync(file, "utf8");
  } catch {
    // No file yet; it gets created.
  }
  const gap = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  fs.appendFileSync(file, `${gap}${MARK}\n${hookLine(shell)}\n`);
}

/** Remove the lines `install` added (and any other `baton init` line). Returns whether anything changed. */
export function uninstall(file: string): boolean {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  const kept = text.split("\n").filter((l) => l !== MARK && !/^\s*eval "\$\(baton init (zsh|bash)\)"\s*$/.test(l));
  const next = kept.join("\n").replace(/\n{3,}$/, "\n\n");
  if (next === text) return false;
  fs.writeFileSync(file, next);
  return true;
}

/** The hook calls `baton` by name, so it must be installed, not only run through npx. */
export function batonOnPath(): boolean {
  try {
    execFileSync("sh", ["-c", "command -v baton"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
