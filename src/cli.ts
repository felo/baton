#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parseClaude } from "./claude.ts";
import { parseCodex } from "./codex.ts";
import { locate } from "./locate.ts";
import type { Found } from "./locate.ts";
import { choose, chooseNext, hasCogenity, readStatus } from "./cogenity.ts";
import type { Choice } from "./cogenity.ts";
import { detectAgent, hookScript, launchCommand, openTab, runHere, shellQuote, takeNote, wasYolo, writeNote } from "./launch.ts";
import { showLogo } from "./logo.ts";
import type { Info, Meta, Tool } from "./model.ts";
import { confirm, pick } from "./picker.ts";
import { render, TOOL_NAMES } from "./render.ts";
import { describe, isOld, keepDays, list, localDate, remove, save, select, selectAll, STATUS_LABELS, storeDir } from "./store.ts";
import type { Entry } from "./store.ts";
import { interactive, openTerminal } from "./terminal.ts";
import { batonOnPath, hookLine, install, isInstalled, rcFile, shellOf, uninstall } from "./setup.ts";
import type { Shell } from "./setup.ts";
import { isDir, plural, tildify } from "./util.ts";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const help = () => `baton ${version} · pass your AI coding session to the next agent

Save the session you're in (run it with "!" inside Claude Code, or in a terminal):
  baton                     save the current Claude Code or Codex session
    --session <id|path>       a specific session instead
    --tool claude|codex       only look at one tool's sessions
    --out <dir>               save somewhere other than ${tildify(storeDir())}
    --stdout                  print it instead of saving
    --full                    don't shorten long command output
    --no-diff                 leave out the uncommitted code changes

Pick one up:
  baton take                choose a hand-over with the arrow keys, then print a
                            "read this and continue" prompt for it
                            (with no terminal, e.g. run by an agent: the latest)
  baton take <which>        skip the picker: a number from \`baton list\`, or text
                            matching the title, project or date
    --latest                  skip the picker and take the newest
    --content                 print the whole hand-over instead of the prompt
    --path                    print only the file path
  baton list                saved hand-overs, newest first

Switch agents in one go:
  baton codex               save this session and start Codex on it
  baton claude              …or Claude Code
  baton next                …or whichever has the most usage left (needs Cogenity)
    --account <email>         with Cogenity: use this account
    --yolo, --no-yolo         skip permission prompts or not (default: as before)
    --dry-run                 show what would happen, change nothing
  From a terminal it starts the agent right there. Inside an agent (\`! baton codex\`)
  it closes that agent and starts the next in the same window, after a one-time:
    baton setup               adds one line to your shell config (--undo removes it)
  With Cogenity installed, the agent starts on the account with room left.

Or start one yourself:
  claude "$(baton take)"
  codex "$(baton take)"

Clean up:
  baton clean               choose what to delete; ones older than ${keepDays() || "∞"} days are pre-selected
  baton clean <which>       delete by number or matching text
  baton flush               delete them all (same as baton clean --all)
    --yes                     don't ask (needed when there's no terminal)
  Hand-overs in ${tildify(storeDir())} older than ${keepDays() || "∞"} days are also removed whenever you save.
  Change that with BATON_KEEP_DAYS (0 keeps them forever).
`;

interface Args {
  _: string[];
  session?: string;
  tool?: string;
  out?: string;
  [flag: string]: string | boolean | string[] | undefined;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--session" || a === "--tool" || a === "--out" || a === "--account") args[a.slice(2)] = argv[++i];
    else if (a.startsWith("--")) args[a.slice(2)] = true;
    else if (a === "-h") args.help = true;
    else if (a === "-v") args.version = true;
    else args._.push(a);
  }
  return args;
}

function fail(msg: string): never {
  process.stderr.write(`baton: ${msg}\n`);
  process.exit(1);
}

const say = (s: string) => void process.stdout.write(s.endsWith("\n") ? s : s + "\n");

function continuePrompt(file: string): string {
  return `Read the hand-over at ${file}. Another AI agent wrote it when it had to stop. Start with its Briefing section, then continue the work.`;
}

interface Saved {
  file: string;
  info: Info;
  meta: Meta;
  /** What to tell the user: where it went, and what it contains. */
  lines: string[];
}

async function saveSession(args: Args): Promise<Saved | null> {
  if (args.tool && !(args.tool in TOOL_NAMES)) fail("--tool must be claude or codex");
  let found: Found;
  try {
    found = locate({ session: args.session, tool: args.tool as Tool | undefined });
  } catch (err) {
    fail((err as Error).message);
  }
  const parsed = (found.tool === "claude" ? parseClaude : parseCodex)(found.file);
  const { markdown, info } = render({ ...found, ...parsed }, { full: !!args.full, diff: !args["no-diff"] });
  if (args.stdout) {
    process.stdout.write(markdown);
    return null;
  }

  const dir = args.out ? path.resolve(args.out) : storeDir();
  const firstRun = !fs.existsSync(dir);
  const file = save(markdown, info, dir);
  if (firstRun && !args.out) await showLogo();
  // Tidy up as we go, so old copies of conversations don't pile up. Only in baton's own folder.
  const pruned = args.out ? 0 : remove(list(dir).filter((e) => e.file !== file && isOld(e)));

  const kb = Math.max(1, Math.round(Buffer.byteLength(markdown) / 1024));
  const lines = [
    `Saved ${tildify(file)}`,
    `  ${TOOL_NAMES[info.source]} · ${STATUS_LABELS[info.status]} · ${plural(info.userMessages, "message")} from you · ${kb} KB`,
  ];
  if (pruned) lines.push(`  Cleaned up ${plural(pruned, "hand-over")} older than ${keepDays()} days.`);
  return { file, info, meta: parsed.meta, lines };
}

async function runSave(args: Args): Promise<void> {
  const saved = await saveSession(args);
  if (!saved) return;
  const { file, lines } = saved;
  const out = [...lines, "", "Hand it to the next agent:"];
  if (args.out) out.push(`  ${continuePrompt(file)}`);
  else {
    out.push(
      `  baton codex               start Codex on it (or baton claude, baton next)`,
      `  claude "$(baton take)"    start one yourself, with any options you like`,
      `  baton take                or print the prompt to paste into any agent`,
    );
  }
  say(out.join("\n"));
}

function output(entry: Entry, args: Args): void {
  if (args.path) say(entry.file);
  else if (args.content) process.stdout.write(fs.readFileSync(entry.file, "utf8"));
  else {
    process.stderr.write(`baton: ${entry.title} (${entry.project ?? "?"}, ${localDate(entry.created)})\n`);
    say(continuePrompt(entry.file));
  }
}

async function runTake(entries: Entry[], args: Args, forcePicker: boolean): Promise<void> {
  const selector = args._.join(" ");
  // With nothing else, `take` opens the picker when someone is at the keyboard;
  // agents and scripts get the latest.
  if (forcePicker || (!selector && !args.latest && interactive())) {
    if (!interactive()) fail("the picker needs an interactive terminal. Use `baton list` and `baton take <number>` instead.");
    const term = openTerminal();
    const chosen = (await pick(term, entries, (e) => describe(e, entries.indexOf(e)).trim())) as Entry | null;
    term.close();
    if (!chosen) process.exit(130);
    return output(chosen, args);
  }
  const { entry, matches } = select(entries, selector);
  if (!entry) fail(`nothing matches "${selector}". See \`baton list\`.`);
  if (matches > 1) process.stderr.write(`baton: ${matches} hand-overs match, taking the newest\n`);
  output(entry, args);
}

async function runClean(entries: Entry[], args: Args): Promise<void> {
  if (!entries.length) return say("Nothing to clean up.");
  const where = tildify(args.out ? path.resolve(args.out) : storeDir());
  const selector = args._.join(" ");
  const days = keepDays();
  const targets = args.all ? entries : selector ? selectAll(entries, selector) : entries.filter((e) => isOld(e, days));
  if (selector && !targets.length) fail(`nothing matches "${selector}". See \`baton list\`.`);

  if (args.yes) return say(`Deleted ${plural(remove(targets), "hand-over")}.`);

  if (!interactive()) {
    if (!targets.length) {
      return say(days ? `Nothing older than ${days} days.` : "Automatic cleanup is off (BATON_KEEP_DAYS=0). Pass a number, some text, or --all.");
    }
    return say(`${targets.map((e) => describe(e, entries.indexOf(e))).join("\n")}\n\nRun again with --yes to delete ${targets.length === 1 ? "it" : `these ${targets.length}`}.`);
  }

  const term = openTerminal();
  try {
    let chosen = targets;
    if (!args.all) {
      // Show everything with the proposed ones ticked, so it's clear what goes and what stays.
      const title = targets.length ? "Delete these hand-overs?" : days ? `Nothing older than ${days} days. Pick any to delete` : "Pick hand-overs to delete";
      const picked = (await pick(term, entries, (e) => describe(e, entries.indexOf(e)).trim(), { title, multi: true, checked: targets })) as Entry[] | null;
      if (!picked) return say("Nothing deleted.");
      chosen = picked;
    }
    if (!chosen.length) return say("Nothing deleted.");
    const question = args.all
      ? `Delete all ${plural(chosen.length, "hand-over")} in ${where}? This can't be undone.`
      : `Delete ${plural(chosen.length, "hand-over")}? This can't be undone.`;
    if (!(await confirm(term, question))) return say("Nothing deleted.");
    say(`Deleted ${plural(remove(chosen), "hand-over")}.`);
  } finally {
    term.close();
  }
}

const other = (t: Tool): Tool => (t === "claude" ? "codex" : "claude");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "04:00", "tomorrow 04:00" or a date, for when a limit resets. */
function when(iso: string): string {
  const d = new Date(iso);
  const day = (x: Date) => x.toDateString();
  const time = localDate(iso).slice(11);
  const now = new Date();
  if (day(d) === day(now)) return time;
  if (day(d) === day(new Date(now.getTime() + 86_400_000))) return `tomorrow ${time}`;
  return localDate(iso);
}

async function ask(question: string, defaultYes: boolean): Promise<boolean> {
  const term = openTerminal();
  try {
    return await confirm(term, question, { defaultYes });
  } finally {
    term.close();
  }
}

/**
 * `baton claude|codex|next`: save this session and start the next agent on it.
 * With Cogenity, on the account it would pick (and not on one that's used up).
 */
async function runHandoff(target: Tool | "next", args: Args): Promise<void> {
  const agent = detectAgent();
  const useCogenity = !args["no-cogenity"];
  const status = useCogenity ? readStatus() : null;
  // Cogenity may be installed even if its status can't be read; then its own picker chooses.
  const viaCogenity = status !== null || (useCogenity && hasCogenity());

  let tool: Tool;
  if (target !== "next") tool = target;
  else {
    const best = status ? chooseNext(status, agent?.tool) : null;
    if (best) tool = best.tool;
    else if (agent) tool = other(agent.tool);
    else fail("`baton next` needs Cogenity to see which account has room. Use `baton claude` or `baton codex`.");
  }

  let chosen: Choice | null = args.account || !status ? null : choose(status, tool);
  if (chosen?.exhausted) {
    const until = chosen.resetsAt ? ` until ${when(chosen.resetsAt)}` : "";
    const msg = `Every ${TOOL_NAMES[tool]} account is used up${until}.`;
    const alt = status ? choose(status, other(tool)) : null;
    if (alt && !alt.exhausted) {
      say(`${msg} Switching to ${TOOL_NAMES[alt.tool]} on ${alt.account} (${alt.used}% used).`);
      tool = alt.tool;
      chosen = alt;
    } else {
      fail(`${msg} No available account on the other tool. Pass --account to use a specific account anyway.`);
    }
  }

  const saved = await saveSession({ ...args, stdout: false, out: undefined });
  if (!saved) return;
  const cwd = isDir(saved.info.cwd) ? saved.info.cwd : process.cwd();
  const account = (args.account as string | undefined) ?? chosen?.account ?? null;
  const yolo = args.yolo ? true : args["no-yolo"] ? false : wasYolo(saved.meta);
  const command = launchCommand(tool, continuePrompt(saved.file), { cogenity: viaCogenity, account, yolo });
  const who =
    TOOL_NAMES[tool] +
    (account ? ` on ${account}` + (chosen && !args.account ? ` (${chosen.used}% used)` : "") : "") +
    (viaCogenity ? " via Cogenity" : "") +
    (yolo ? ", without permission prompts" : "");
  say(saved.lines.join("\n"));

  if (args["dry-run"]) return say(`\nWould start ${who}:\n  cd ${shellQuote([cwd])} && ${shellQuote(command)}`);

  if (!agent) {
    say(`\nStarting ${who}…`);
    process.exitCode = await runHere(command, cwd);
    return;
  }
  if (process.env.BATON_HOOK) {
    writeNote(command, cwd);
    say(`\nClosing ${TOOL_NAMES[agent.tool]}. ${who} starts in this window in a moment.`);
    await sleep(300); // let that line show before the agent's screen goes
    try {
      process.kill(agent.pid, "SIGTERM");
    } catch (err) {
      fail(`couldn't close ${TOOL_NAMES[agent.tool]} (${(err as Error).message}). Quit it yourself; ${TOOL_NAMES[tool]} starts when you do.`);
    }
    return;
  }
  const line = `cd ${shellQuote([cwd])} && ${shellQuote(command)}`;
  if (openTab(line)) return say(`\nOpened ${who} in a new tab. You can close this chat.`);
  say(
    `\nStart ${who} with:\n  ${line}\n\n` +
      `Tip: run \`baton setup\` once in a terminal, and next time \`! baton ${tool}\` switches in this window by itself.`,
  );
}

async function runSetup(args: Args): Promise<void> {
  const shell = (args._[0] as Shell | undefined) ?? shellOf();
  if (shell !== "zsh" && shell !== "bash") {
    const name = args._[0] || path.basename(process.env.SHELL || "");
    fail(`\`baton setup\` supports zsh and bash${name ? `, not ${name}` : ""}. Try \`baton setup zsh\`.`);
  }
  const file = rcFile(shell);
  const where = tildify(file);

  if (args.undo) {
    return say(uninstall(file) ? `Removed the baton line from ${where}. Open a new terminal tab for it to take effect.` : `Nothing to remove: ${where} has no baton line.`);
  }
  if (isInstalled(file)) return say(`Already set up: ${where} has the baton line. \`! baton codex\` switches in the same window.`);
  if (!batonOnPath()) fail("the shell line calls `baton` by name, so install it first: npm i -g baton-ai");

  say(
    `This adds one line to ${where}:\n\n  ${hookLine(shell)}\n\n` +
      "After an agent runs `! baton codex` (or claude, or next), it starts the next agent in the same window.\n" +
      "It does nothing else, and `baton setup --undo` removes it.\n",
  );
  if (!args.yes) {
    if (!interactive()) return say(`Run \`baton setup --yes\` to add it, or add the line yourself.`);
    if (!(await ask(`Add it to ${where}?`, true))) return say("Nothing changed.");
  }
  install(file, shell);
  say(`Added. Open a new terminal tab to turn it on (or run: source ${where}).`);
}

function runInit(args: Args): void {
  const shell = args._[0] || path.basename(process.env.SHELL || "");
  const script = hookScript(shell);
  if (!script) fail(`no hook for "${shell}" yet. Supported: zsh, bash.`);
  process.stdout.write(script);
}

/** Called by the shell hook: print the command a hand-over left for this shell, if any. */
function runNext(): void {
  const line = takeNote();
  if (!line) return;
  process.stderr.write("baton: starting the next agent on the hand-over…\n");
  say(line);
}

async function main(argv: string[]): Promise<void> {
  // `baton take --content | head` closes the pipe early; that's not an error.
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });
  const commands = ["save", "list", "ls", "take", "pick", "clean", "flush", "claude", "codex", "next", "setup", "init", "_next", "help"];
  const command = commands.includes(argv[0]) ? argv[0] : "save";
  const args = parseArgs(command === argv[0] ? argv.slice(1) : argv);

  if (args.version) return say(version);
  if (args.help || command === "help") {
    await showLogo();
    return void process.stdout.write(help());
  }
  if (command === "save") return runSave(args);
  if (command === "claude" || command === "codex" || command === "next") return runHandoff(command, args);
  if (command === "setup") return runSetup(args);
  if (command === "init") return runInit(args);
  if (command === "_next") return runNext();

  const entries = list(args.out ? path.resolve(args.out) : undefined);
  if (command === "clean" || command === "flush") return runClean(entries, { ...args, all: args.all || command === "flush" });
  if (!entries.length) fail(`no hand-overs saved in ${tildify(args.out || storeDir())} yet. Run \`baton\` in a session first.`);
  if (command === "list" || command === "ls") return say(entries.map(describe).join("\n"));
  return runTake(entries, args, command === "pick");
}

await main(process.argv.slice(2));
