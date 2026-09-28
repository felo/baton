#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { locate } from "../src/locate.js";
import { parseClaude } from "../src/claude.js";
import { parseCodex } from "../src/codex.js";
import { render, TOOL_NAMES } from "../src/render.js";
import { list, localDate, save, select, STATUS_LABELS, storeDir } from "../src/store.js";
import { pick } from "../src/picker.js";
import { showLogo } from "../src/logo.js";
import { HOME } from "../src/util.js";

const { version } = createRequire(import.meta.url)("../package.json");

const HELP = `baton ${version} · pass your AI coding session to the next agent

Save the session you're in (run it with "!" inside Claude Code, or in a terminal):
  baton                     save the current Claude Code or Codex session
    --session <id|path>       a specific session instead
    --tool claude|codex       only look at one tool's sessions
    --out <dir>               save somewhere other than ${tildify(storeDir())}
    --stdout                  print it instead of saving
    --full                    don't shorten long command output
    --no-diff                 leave out the uncommitted code changes

Pick one up:
  baton list                saved hand-overs, newest first
  baton take [which]        print a "read this hand-over and continue" prompt for one:
                            the latest, a number from the list, or text matching
                            its title, project or date
  baton pick                the same, choosing with the arrow keys
    --content                 print the whole hand-over instead
    --path                    print only the file path

Start a new agent on it:
  claude "$(baton take)"
  codex "$(baton pick)"
`;

function tildify(p) {
  return p.startsWith(HOME) ? "~" + p.slice(HOME.length) : p;
}

function parseArgs(argv) {
  const args = { _: [] };
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

function fail(msg) {
  process.stderr.write(`baton: ${msg}\n`);
  process.exit(1);
}

function continuePrompt(file) {
  return `Read the hand-over at ${file}. Another AI agent wrote it when it had to stop. Start with its Briefing section, then continue the work.`;
}

async function runSave(args) {
  if (args.tool && !TOOL_NAMES[args.tool]) fail("--tool must be claude or codex");
  let found;
  try {
    found = locate({ session: args.session, tool: args.tool });
  } catch (err) {
    fail(err.message);
  }
  const parsed = (found.tool === "claude" ? parseClaude : parseCodex)(found.file);
  const { markdown, info } = render({ ...found, ...parsed }, { full: !!args.full, diff: !args["no-diff"] });
  if (args.stdout) {
    process.stdout.write(markdown);
    return;
  }
  const dir = args.out ? path.resolve(args.out) : storeDir();
  const firstRun = !fs.existsSync(dir);
  const file = save(markdown, info, dir);
  if (firstRun && !args.out) await showLogo();
  const kb = Math.max(1, Math.round(Buffer.byteLength(markdown) / 1024));
  const out = [
    `Saved ${tildify(file)}`,
    `  ${TOOL_NAMES[info.source]} · ${STATUS_LABELS[info.status]} · ${info.userMessages} messages from you · ${kb} KB`,
    "",
    "Hand it to the next agent:",
  ];
  if (args.out) {
    out.push(`  ${continuePrompt(file)}`);
  } else {
    out.push(
      `  claude "$(baton take)"    start a new Claude Code chat on it`,
      `  codex "$(baton take)"     or a Codex one`,
      `  baton take                or print the prompt to paste into any agent`,
    );
  }
  process.stdout.write(out.join("\n") + "\n");
}

function output(entry, args) {
  if (args.path) process.stdout.write(entry.file + "\n");
  else if (args.content) process.stdout.write(fs.readFileSync(entry.file, "utf8"));
  else {
    process.stderr.write(`baton: ${entry.title} (${entry.project}, ${localDate(entry.created)})\n`);
    process.stdout.write(continuePrompt(entry.file) + "\n");
  }
}

function describe(e, i) {
  const status = STATUS_LABELS[e.status] || "";
  return `${String(i + 1).padStart(2)}  ${localDate(e.created)}  ${(e.project || "").padEnd(18).slice(0, 18)}  ${e.title}${status ? `  · ${status}` : ""}`;
}

// `baton take --content | head` closes the pipe early; that's not an error.
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const commands = ["save", "list", "ls", "take", "pick", "help"];
  const args = parseArgs(commands.includes(cmd) ? rest : process.argv.slice(2));
  const command = commands.includes(cmd) ? cmd : "save";

  if (args.version) return void process.stdout.write(version + "\n");
  if (args.help || command === "help") {
    await showLogo();
    return void process.stdout.write(HELP);
  }

  if (command === "save") return runSave(args);

  const entries = list(args.out ? path.resolve(args.out) : undefined);
  if (!entries.length) fail(`no hand-overs saved in ${tildify(args.out || storeDir())} yet. Run \`baton\` in a session first.`);

  if (command === "list" || command === "ls") {
    process.stdout.write(entries.map(describe).join("\n") + "\n");
    return;
  }
  if (command === "take") {
    const { entry, matches } = select(entries, args._.join(" "));
    if (!entry) fail(`nothing matches "${args._.join(" ")}". See \`baton list\`.`);
    if (matches > 1) process.stderr.write(`baton: ${matches} hand-overs match, taking the newest\n`);
    return output(entry, args);
  }
  if (command === "pick") {
    const indexed = entries.map((e, i) => ({ ...e, i }));
    const chosen = await pick(indexed, (e) => describe(e, e.i).trim()).catch((err) => fail(err.message));
    if (!chosen) process.exit(130);
    return output(chosen, args);
  }
}

main();
