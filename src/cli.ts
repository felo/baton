#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parseClaude } from "./claude.ts";
import { parseCodex } from "./codex.ts";
import { locate } from "./locate.ts";
import type { Found } from "./locate.ts";
import { showLogo } from "./logo.ts";
import type { Tool } from "./model.ts";
import { confirm, pick } from "./picker.ts";
import { render, TOOL_NAMES } from "./render.ts";
import { describe, isOld, keepDays, list, localDate, remove, save, select, selectAll, STATUS_LABELS, storeDir } from "./store.ts";
import type { Entry } from "./store.ts";
import { interactive, openTerminal } from "./terminal.ts";
import { plural, tildify } from "./util.ts";

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

Start a new agent on one:
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
    if (a === "--session" || a === "--tool" || a === "--out") args[a.slice(2)] = argv[++i];
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

async function runSave(args: Args): Promise<void> {
  if (args.tool && !(args.tool in TOOL_NAMES)) fail("--tool must be claude or codex");
  let found: Found;
  try {
    found = locate({ session: args.session, tool: args.tool as Tool | undefined });
  } catch (err) {
    fail((err as Error).message);
  }
  const parsed = (found.tool === "claude" ? parseClaude : parseCodex)(found.file);
  const { markdown, info } = render({ ...found, ...parsed }, { full: !!args.full, diff: !args["no-diff"] });
  if (args.stdout) return void process.stdout.write(markdown);

  const dir = args.out ? path.resolve(args.out) : storeDir();
  const firstRun = !fs.existsSync(dir);
  const file = save(markdown, info, dir);
  if (firstRun && !args.out) await showLogo();
  // Tidy up as we go, so old copies of conversations don't pile up. Only in baton's own folder.
  const pruned = args.out ? 0 : remove(list(dir).filter((e) => e.file !== file && isOld(e)));

  const kb = Math.max(1, Math.round(Buffer.byteLength(markdown) / 1024));
  const out = [
    `Saved ${tildify(file)}`,
    `  ${TOOL_NAMES[info.source]} · ${STATUS_LABELS[info.status]} · ${plural(info.userMessages, "message")} from you · ${kb} KB`,
  ];
  if (pruned) out.push(`  Cleaned up ${plural(pruned, "hand-over")} older than ${keepDays()} days.`);
  out.push("", "Hand it to the next agent:");
  if (args.out) out.push(`  ${continuePrompt(file)}`);
  else {
    out.push(
      `  claude "$(baton take)"    start a new Claude Code chat on it`,
      `  codex "$(baton take)"     or a Codex one`,
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

async function main(argv: string[]): Promise<void> {
  // `baton take --content | head` closes the pipe early; that's not an error.
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });
  const commands = ["save", "list", "ls", "take", "pick", "clean", "flush", "help"];
  const command = commands.includes(argv[0]) ? argv[0] : "save";
  const args = parseArgs(command === argv[0] ? argv.slice(1) : argv);

  if (args.version) return say(version);
  if (args.help || command === "help") {
    await showLogo();
    return void process.stdout.write(help());
  }
  if (command === "save") return runSave(args);

  const entries = list(args.out ? path.resolve(args.out) : undefined);
  if (command === "clean" || command === "flush") return runClean(entries, { ...args, all: args.all || command === "flush" });
  if (!entries.length) fail(`no hand-overs saved in ${tildify(args.out || storeDir())} yet. Run \`baton\` in a session first.`);
  if (command === "list" || command === "ls") return say(entries.map(describe).join("\n"));
  return runTake(entries, args, command === "pick");
}

await main(process.argv.slice(2));
