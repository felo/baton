import { contentText, describeToolInput, readJsonl, stripNoise } from "./util.js";
import { INJECTED, newMeta, note } from "./model.js";

const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Read a Claude Code transcript into the shared turn format (see model.js). */
export function parseClaude(file) {
  const meta = newMeta();
  const turns = [];
  const files = new Set();
  const plans = new Map(); // tool_use id -> index of its plan turn

  for (const e of readJsonl(file)) {
    const t = e.type;
    if (t === "ai-title") meta.title = e.aiTitle;
    if (t === "permission-mode") note(meta, "Permission mode", e.permissionMode);
    if (t === "assistant" && !e.isSidechain) note(meta, "Reasoning effort", e.perTurnEffort || e.effort);

    const att = e.attachment || {};
    if (t === "attachment" && att.type === "queued_command" && !e.isSidechain) {
      // A message the user typed while the agent was mid-task.
      const text = stripNoise(contentText(att.prompt));
      if (text && att.humanTurn !== false) turns.push({ kind: "user", text });
      continue;
    }
    // Sidechains are sub-agents; their final answers already appear as tool results.
    if (e.isSidechain || (t !== "user" && t !== "assistant")) continue;

    meta.first ||= e.timestamp;
    meta.last = e.timestamp || meta.last;
    meta.cwd = e.cwd || meta.cwd;
    meta.branch = e.gitBranch || meta.branch;
    const msg = e.message || {};
    const content = msg.content;
    if (t === "assistant" && msg.model && !msg.model.startsWith("<")) meta.models.add(msg.model);

    if (e.isCompactSummary) {
      turns.push({ kind: "summary", text: contentText(content) });
      continue;
    }
    if (e.isApiErrorMessage) {
      turns.push({ kind: "error", text: stripNoise(contentText(content)), code: e.error });
      continue;
    }
    if (typeof content === "string") {
      if (t === "user" && e.isMeta) continue;
      const text = stripNoise(content);
      if (t === "user" && (e.promptSource === "system" || INJECTED.test(text))) {
        // Harness notices (background task finished, hook output…), not the user typing.
        turns.push({ kind: "notice", text });
      } else if (text) {
        turns.push({ kind: t, text });
      }
      continue;
    }

    for (const block of content || []) {
      if (block.type === "text") {
        const text = stripNoise(block.text || "");
        if (text) turns.push({ kind: t, text });
      } else if (block.type === "tool_use") {
        const input = block.input || {};
        if (EDIT_TOOLS.has(block.name)) {
          for (const k of ["file_path", "notebook_path"]) if (typeof input[k] === "string") files.add(input[k]);
        }
        if (block.name === "ExitPlanMode" && input.plan) {
          plans.set(block.id, turns.length);
          turns.push({ kind: "plan", text: input.plan, approved: null });
          continue;
        }
        turns.push({ kind: "tool_call", name: block.name || "tool", text: describeToolInput(input) });
      } else if (block.type === "tool_result") {
        const text = stripNoise(contentText(block.content));
        const planIdx = plans.get(block.tool_use_id);
        if (planIdx !== undefined) {
          const approved = /approved/i.test(text) && !block.is_error;
          turns[planIdx].approved = approved;
          turns.push({ kind: "tool_result", text: approved ? "User approved the plan." : text, error: !!block.is_error });
          continue;
        }
        turns.push({ kind: "tool_result", text, error: !!block.is_error });
      }
    }
  }
  return { meta, turns, files };
}
