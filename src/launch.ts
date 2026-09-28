// Starting the next agent: directly when run from a terminal, or, when run
// from inside an agent (`! baton codex`), by closing that agent and letting a
// small shell hook start the next one in the same window.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Meta, Tool } from "./model.ts";
import { storeDir } from "./store.ts";

export interface Agent {
  tool: Tool;
  pid: number;
}

export type ProcessInfo = (pid: number) => { ppid: number; command: string } | null;

export const psInfo: ProcessInfo = (pid) => {
  try {
    const line = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const m = line.match(/^(\d+)\s+(.+)$/);
    return m ? { ppid: Number(m[1]), command: m[2] } : null;
  } catch {
    return null;
  }
};

/**
 * The agent this command runs inside, if any. Claude Code says so itself
 * (CLAUDECODE, CLAUDE_PID); otherwise walk up the process tree looking for a
 * claude or codex process. BATON_AGENT overrides both.
 */
export function detectAgent(env: NodeJS.ProcessEnv = process.env, ps: ProcessInfo = psInfo, start = process.ppid): Agent | null {
  // Explicit override: "none", or "claude:<pid>" / "codex:<pid>". Tests use it so they never find a real agent.
  if (env.BATON_AGENT) {
    const m = env.BATON_AGENT.match(/^(claude|codex):(\d+)$/);
    return m ? { tool: m[1] as Tool, pid: Number(m[2]) } : null;
  }
  if ((env.CLAUDECODE === "1" || env.CLAUDE_CODE_SESSION_ID) && Number(env.CLAUDE_PID) > 1) {
    return { tool: "claude", pid: Number(env.CLAUDE_PID) };
  }
  let pid = start;
  for (let depth = 0; pid > 1 && depth < 20; depth++) {
    const info = ps(pid);
    if (!info) break;
    const name = path.basename(info.command.split(" ")[0]);
    if (name === "claude" || name === "codex") return { tool: name, pid };
    pid = info.ppid;
  }
  return null;
}

/** Whether the previous agent ran without permission prompts, so the next one can too. */
export function wasYolo(meta: Meta): boolean {
  const last = (key: string) => meta.settings[key]?.[meta.settings[key].length - 1];
  return last("Permission mode") === "bypassPermissions" || (last("Sandbox") === "danger-full-access" && last("Approvals") === "never");
}

/** The command that starts `tool` with `prompt` as its first message. */
export function launchCommand(tool: Tool, prompt: string, { cogenity = false, account, yolo = false }: { cogenity?: boolean; account?: string | null; yolo?: boolean } = {}): string[] {
  if (cogenity) return ["cogenity", ...(yolo ? ["--yolo"] : []), `--${tool}`, ...(account ? ["--account", account] : []), "--", prompt];
  if (tool === "claude") return ["claude", ...(yolo ? ["--dangerously-skip-permissions"] : []), prompt];
  return ["codex", ...(yolo ? ["--yolo"] : []), prompt];
}

/** Quote words for sh, bash and zsh. */
export function shellQuote(args: string[]): string {
  return args.map((a) => (/^[A-Za-z0-9_/.:@%+=,-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(" ");
}

// ---- the note the shell hook picks up ----

const NOTE_MAX_AGE_MS = 2 * 60_000;
export const notePath = (dir = storeDir()) => path.join(dir, ".next.json");

export function writeNote(command: string[], cwd: string, dir = storeDir(), now = Date.now()): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(notePath(dir), JSON.stringify({ command, cwd, created: now }));
}

/**
 * Take the note, if there's a fresh one, as a shell command line. The note is
 * always removed, so a stale one can't start an agent by surprise later.
 */
export function takeNote(dir = storeDir(), now = Date.now()): string | null {
  const file = notePath(dir);
  let note: { command?: unknown; cwd?: unknown; created?: unknown };
  try {
    note = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  } finally {
    fs.rmSync(file, { force: true });
  }
  if (!Array.isArray(note.command) || !note.command.every((a) => typeof a === "string") || typeof note.cwd !== "string") return null;
  if (typeof note.created !== "number" || now - note.created > NOTE_MAX_AGE_MS || note.created > now + 5000) return null;
  return `cd ${shellQuote([note.cwd])} && ${shellQuote(note.command)}`;
}

/** The shell hook: after each command, start the agent a hand-over asked for. */
export function hookScript(shell: string): string | null {
  const note = `"\${BATON_DIR:-$HOME/.baton}/.next.json"`;
  const body = `_baton_next() {
  [ -f ${note} ] || return 0
  local c
  c="$(command baton _next)" && [ -n "$c" ] && eval "$c"
}`;
  if (shell === "zsh") {
    return `# baton: continue in this window after \`! baton claude|codex|next\`
export BATON_HOOK=zsh
${body}
autoload -Uz add-zsh-hook
add-zsh-hook precmd _baton_next
`;
  }
  if (shell === "bash") {
    return `# baton: continue in this window after \`! baton claude|codex|next\`
export BATON_HOOK=bash
${body}
case ";$PROMPT_COMMAND;" in *";_baton_next;"*) ;; *) PROMPT_COMMAND="_baton_next\${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;; esac
`;
  }
  return null;
}

// ---- without the hook: a new tab ----

const appleString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** osascript arguments that open a new tab running `line`, for terminals that allow it. */
export function newTabScript(termProgram: string | undefined, line: string): string[] | null {
  if (termProgram === "Apple_Terminal") {
    return ["-e", `tell application "Terminal" to do script ${appleString(line)}`, "-e", 'tell application "Terminal" to activate'];
  }
  if (termProgram === "iTerm.app") {
    return [
      "-e",
      'tell application "iTerm" to tell current window to create tab with default profile',
      "-e",
      `tell application "iTerm" to tell current session of current window to write text ${appleString(line)}`,
    ];
  }
  return null;
}

export function openTab(line: string, termProgram = process.env.TERM_PROGRAM): boolean {
  const script = newTabScript(termProgram, line);
  if (!script || process.platform !== "darwin") return false;
  try {
    execFileSync("osascript", script, { stdio: "ignore", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/** Run the next agent in this terminal, handing it the keyboard until it exits. */
export function runHere(command: string[], cwd = process.cwd()): Promise<number> {
  return new Promise((resolve) => {
    // Ctrl-C belongs to the agent now; baton just waits for it.
    const ignore = () => {};
    process.on("SIGINT", ignore);
    const child = spawn(command[0], command.slice(1), { stdio: "inherit", cwd });
    child.on("error", (err) => {
      process.removeListener("SIGINT", ignore);
      process.stderr.write(`baton: couldn't start ${command[0]}: ${err.message}\n`);
      resolve(127);
    });
    child.on("exit", (code, signal) => {
      process.removeListener("SIGINT", ignore);
      resolve(code ?? (signal ? 128 : 0));
    });
  });
}
