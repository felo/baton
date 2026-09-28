import fs from "node:fs";
import path from "node:path";
import type { Info, Meta, Session, StopCode, Tool, Turn } from "./model.ts";
import { instructionFiles } from "./instructions.ts";
import type { InstructionKind } from "./instructions.ts";
import { fullPatch, isRepo, repoState } from "./repo.ts";
import type { RepoState } from "./repo.ts";
import { clip, fence, firstLine, HOME, redact } from "./util.ts";

const TOOL_INPUT_MAX = 800;
const TOOL_OUTPUT_MAX = 2000;
export const TOOL_NAMES: Record<Tool, string> = { claude: "Claude Code", codex: "Codex" };

/** Why the previous agent stopped, judged from what came after the user's last message. */
export function stopStatus(turns: Turn[]): { code: StopCode; line: string } {
  let lastUser = -1;
  turns.forEach((t, i) => {
    if (t.kind === "user") lastUser = i;
  });
  const tail = turns.slice(lastUser + 1);
  const errors = tail.filter((t) => t.kind === "error");
  const lastError = errors[errors.length - 1];
  if (lastError) {
    const text = firstLine(lastError.text, 300);
    if (/limit|credits|quota/i.test(`${lastError.code || ""} ${text}`)) {
      return { code: "out-of-usage", line: `**It ran out of usage** and stopped mid-task: "${text}". Its work on the user's last message is probably unfinished.` };
    }
    return { code: "error", line: `**It stopped on an error:** "${text}". Its work on the user's last message may be unfinished.` };
  }
  if (!tail.length) return { code: "unanswered", line: "**The user's last message hasn't been answered yet.** Start there." };
  const last = tail.filter((t) => t.kind !== "thought" && t.kind !== "notice").pop() || tail[tail.length - 1];
  if (last.kind === "tool_call" || last.kind === "tool_result" || last.kind === "plan") {
    return {
      code: "mid-task",
      line: "**It stopped mid-task:** its last action was a tool call with no reply to the user after it. Its work on the user's last message is probably unfinished.",
    };
  }
  return { code: "finished", line: "**It finished its last reply** and was waiting for the user. Continue from the user's next instruction." };
}

function lastAction(turns: Turn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.kind === "tool_call") return `\`${t.name}\`: ${firstLine(t.text, 160)}`;
  }
  return null;
}

export function titleOf(meta: Meta, turns: Turn[]): string {
  if (meta.title) return meta.title;
  const firstUser = turns.find((t) => t.kind === "user");
  return firstUser ? firstLine(firstUser.text, 60) : path.basename(meta.cwd || process.cwd());
}

const byApproval = <T>(approved: boolean | null, yes: T, no: T, none: T): T => (approved === true ? yes : approved === false ? no : none);

function conversation(turns: Turn[], full: boolean): string[] {
  const out: string[] = [];
  for (const t of turns) {
    switch (t.kind) {
      case "summary":
        out.push("### Earlier context (summarised when the session was compacted)\n\n" + t.text + "\n");
        break;
      case "user":
        out.push("### 🧑 User\n\n" + t.text + "\n");
        break;
      case "assistant":
        out.push("### 🤖 Agent\n\n" + t.text + "\n");
        break;
      case "thought":
        out.push(`*💭 ${t.text}*\n`);
        break;
      case "notice":
        out.push("**⚙️ automatic notice** (not typed by the user)\n\n" + fence(clip(t.text, TOOL_INPUT_MAX, full)) + "\n");
        break;
      case "plan":
        out.push(`**📋 Plan${byApproval(t.approved, " (approved)", " (not approved)", "")}**\n\n` + fence(clip(t.text, TOOL_INPUT_MAX, full)) + "\n");
        break;
      case "error":
        out.push(`**⚠️ Stopped: ${firstLine(t.text, 300)}**\n`);
        break;
      case "tool_call":
        out.push(`**→ ${t.name}**\n\n` + fence(clip(t.text, TOOL_INPUT_MAX, full)) + "\n");
        break;
      case "tool_result":
        out.push((t.error ? "**← result (error)**" : "**← result**") + "\n\n" + fence(clip(t.text, TOOL_OUTPUT_MAX, full) || "(empty)") + "\n");
        break;
    }
  }
  return out;
}

interface Section {
  heading: string;
  purpose: string;
  body: string[];
}

/**
 * Build the hand-over document: a briefing first, then numbered sections in
 * reading order. `info` is what `baton list` shows.
 */
export function render(
  { file, tool, meta, turns, files }: Session,
  { full = false, diff = true, now = new Date() }: { full?: boolean; diff?: boolean; now?: Date } = {},
): { markdown: string; info: Info } {
  const cwd = meta.cwd || process.cwd();
  const title = titleOf(meta, turns);
  const source = TOOL_NAMES[tool];
  const models = [...meta.models].sort().join(", ") || "model unknown";
  const sections: Section[] = [];

  const instr = instructionFiles(cwd, file);
  if (instr.length) {
    const kinds: Record<InstructionKind, string> = {
      global: "global instructions",
      project: "project instructions",
      imported: "imported by an instruction file",
      memory: "saved memory",
    };
    const body = ["The previous agent was loaded with these files before the conversation started. They are the user's rules for how to work. Follow them.\n"];
    for (const { kind, file: f } of instr) {
      let text: string;
      try {
        text = fs.readFileSync(f, "utf8").trim();
      } catch {
        continue;
      }
      body.push(`### \`${f.replace(HOME, "~")}\` (${kinds[kind]})\n\n${fence(text, "markdown")}\n`);
    }
    sections.push({ heading: "Standing instructions and memory", purpose: "the user's rules for how to work, which the previous agent was loaded with. Follow them.", body });
  }

  const session = [`- **Written:** ${now.toISOString()}`, `- **Source:** ${source} (${models})`];
  for (const [k, vals] of Object.entries(meta.settings)) session.push(`- **${k}:** ${vals.join(" → ")}`);
  session.push(`- **Working directory:** \`${cwd}\``, `- **Conversation:** ${meta.first || "?"} → ${meta.last || "?"}`, `- **Transcript file:** \`${file}\`\n`);
  sections.push({ heading: "Session", purpose: "which tool, model and settings the previous agent ran with, and where.", body: session });

  const plans = turns.filter((t): t is Extract<Turn, { kind: "plan" }> => t.kind === "plan");
  const plan = plans[plans.length - 1];
  if (plan) {
    const state = byApproval(
      plan.approved,
      "The user **approved** this plan.",
      "The user **did not approve** this plan. Check the conversation for what they wanted changed.",
      "This is the agent's own latest checklist.",
    );
    sections.push({ heading: "Latest plan", purpose: "the most recent plan the agent wrote, in full.", body: [state + "\n", plan.text.trim() + "\n"] });
  }

  let patch = "";
  let skipped: string[] = [];
  let repo: RepoState | null = null;
  if (isRepo(cwd)) {
    repo = repoState(cwd);
    if (diff) ({ patch, skipped } = fullPatch(cwd));
    const body = [
      `- **Branch:** \`${repo.branch}\`` + (repo.remote ? `  ·  **Remote:** ${repo.remote}` : ""),
      "\n**Uncommitted changes:**\n\n" + fence(repo.status || "(clean)"),
    ];
    if (repo.stat) body.push("\n**Diff summary vs HEAD:**\n\n" + fence(repo.stat));
    if (repo.base) body.push(`\n**Base commit:** \`${repo.base}\``);
    if (repo.log) body.push("\n**Recent commits:**\n\n" + fence(repo.log));
    body.push("");
    sections.push({
      heading: "Repository state",
      purpose: "branch, uncommitted changes and recent commits when this file was written. Compare with the live checkout before editing.",
      body,
    });
  }

  if (files.size) {
    sections.push({ heading: "Files the previous agent edited", purpose: "every file it wrote or changed.", body: [...[...files].sort().map((f) => `- \`${f}\``), ""] });
  }

  sections.push({
    heading: "Full conversation",
    purpose: "everything the user and the agent said, and every command it ran with the result, oldest first.",
    body: conversation(turns, full),
  });

  if (patch || skipped.length) {
    const body = [
      "Everything that differs from the base commit, new files included. Apply with `git apply <file>` on a clean checkout of the base commit. Any `[REDACTED]` here was a real value you'll need to restore.\n",
    ];
    if (skipped.length) body.push("Too large to include (copy these by hand):\n", ...skipped.map((f) => `- \`${f}\``), "");
    if (patch) body.push(fence(patch.trimEnd(), "diff"));
    sections.push({ heading: "Full uncommitted changes", purpose: "all unfinished code changes as one patch. Only needed if your checkout doesn't already have them.", body });
  }

  // ---- briefing ----
  const status = stopStatus(turns);
  const userMsgs = turns.filter((t) => t.kind === "user");
  const out = [
    `# Hand-over: ${title}\n`,
    "## Briefing\n",
    `You are taking over from another AI coding agent (${source}, ${models}) that was working with a user in \`${cwd}\`. ` +
      "It could not continue, so this file gives you everything it knew. Read this briefing first, then the sections in order.\n",
    "### Where things stand\n",
    `- ${status.line}`,
  ];
  const act = lastAction(turns);
  if (act) out.push(`- **Its last action:** ${act}`);
  if (plan) {
    out.push(
      "- **Plan:** " +
        byApproval(
          plan.approved,
          "the user approved the plan in *Latest plan*. Check the conversation for how much of it is done.",
          "its latest plan was not approved. See *Latest plan* and the conversation.",
          "its latest checklist is in *Latest plan*.",
        ),
    );
  }
  if (repo?.changed) out.push(`- **Code:** ${repo.changed} file(s) have uncommitted changes` + (patch ? ", and the full patch is at the end." : "."));
  const lastUser = userMsgs[userMsgs.length - 1];
  if (lastUser) {
    out.push(
      status.code === "finished"
        ? "- **The user's last message** (already answered; wait for their next instruction):\n"
        : "- **The user's last message, which is your task:**\n",
    );
    out.push("  > " + lastUser.text.replace(/\n/g, "\n  > "));
  }
  out.push("\n### What's in this file\n");
  sections.forEach((s, i) => out.push(`${i + 1}. **${s.heading}**: ${s.purpose}`));
  out.push(
    "\n### How to read it\n",
    "- 🧑 is the user, 🤖 is the previous agent.\n" +
      "- **→ name** is a tool call and **← result** is what came back. The names are the previous agent's tools (e.g. `Bash`, `Edit`, `exec`); use your own equivalents.\n" +
      "- *💭 lines* are the agent's own short labels for what it was thinking at that step. Its full reasoning isn't recorded.\n" +
      "- ⚙️ is an automatic notice from the tool (e.g. a background job finished), not something the user typed.\n" +
      "- 📋 is a plan the agent proposed. ⚠️ marks where it was cut off by a usage limit or error.\n" +
      "- Long tool output is cut, and likely secrets are replaced with `[REDACTED]`. Re-run a command if you need the full output.\n",
    "### Rules\n",
  );
  const instrNo = sections.findIndex((s) => s.heading.startsWith("Standing")) + 1;
  out.push(
    (instrNo
      ? `1. Follow the user's standing instructions (section ${instrNo}). They still apply.\n`
      : "1. Follow any rules the user gave in the conversation. They still apply.\n") +
      "2. Don't repeat finished work. Check the live repository, then pick up where the agent stopped.\n" +
      "3. If something here conflicts with what you see on disk, trust the disk and tell the user.\n",
  );
  sections.forEach((s, i) => out.push(`## ${i + 1}. ${s.heading}\n`, ...s.body));

  const info: Info = {
    title,
    project: path.basename(cwd),
    cwd,
    source: tool,
    status: status.code,
    created: now.toISOString(),
    userMessages: userMsgs.length,
  };
  // First line carries metadata so `baton list` can show it without parsing the whole file.
  const header = `<!-- baton ${JSON.stringify(info).replace(/--/g, "- -")} -->\n`;
  return { markdown: header + redact(out.join("\n")) + "\n", info };
}
