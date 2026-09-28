import { contentText, describeToolInput, readJsonl, stripNoise } from "./util.js";
import { INJECTED, newMeta, note } from "./model.js";

const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
// Context Codex adds to the first user message; dropped rather than shown as notices.
const CONTEXT_TAGS = ["<environment_context", "<recommended_plugins", "<user_instructions", "<permissions", "<INSTRUCTIONS"];

/** Read a Codex rollout transcript into the shared turn format (see model.js). */
export function parseCodex(file) {
  const meta = newMeta();
  const turns = [];
  const files = new Set();

  for (const e of readJsonl(file)) {
    const t = e.type;
    const p = e.payload || {};
    if (t === "session_meta") {
      meta.cwd = p.cwd;
      meta.branch = p.git?.branch || null;
    }
    if (t === "turn_context") {
      if (p.model) meta.models.add(p.model);
      note(meta, "Reasoning effort", p.effort);
      const sandbox = p.sandbox_policy;
      note(meta, "Sandbox", sandbox && typeof sandbox === "object" ? sandbox.type : sandbox);
      const approval = p.approval_policy;
      if (approval != null) note(meta, "Approvals", typeof approval === "string" ? approval : "custom rules");
      note(meta, "Mode", p.collaboration_mode?.mode);
    }
    if (t === "event_msg" && (p.type === "error" || p.type === "stream_error")) {
      turns.push({ kind: "error", text: String(p.message || JSON.stringify(p)), code: p.codex_error_info || p.type });
      continue;
    }
    if (t !== "response_item") continue;

    meta.first ||= e.timestamp;
    meta.last = e.timestamp || meta.last;

    if (p.type === "reasoning") {
      // The reasoning itself is encrypted; Codex keeps a short plain title per step.
      for (const part of p.summary || []) {
        const title = (part.text || "").trim().replace(/^\*+|\*+$/g, "").trim();
        if (title) turns.push({ kind: "thought", text: title });
      }
    } else if (p.type === "message") {
      if (p.role !== "user" && p.role !== "assistant") continue;
      let parts = Array.isArray(p.content) ? p.content : [];
      if (p.role === "user") {
        parts = parts.filter((c) => !CONTEXT_TAGS.some((tag) => (c.text || "").trimStart().startsWith(tag)));
        if (parts.length && parts.every((c) => INJECTED.test(c.text || ""))) {
          turns.push({ kind: "notice", text: stripNoise(contentText(parts)) });
          continue;
        }
      }
      const text = stripNoise(contentText(parts));
      if (text) turns.push({ kind: p.role, text });
    } else if (["function_call", "custom_tool_call", "local_shell_call"].includes(p.type)) {
      const raw = p.arguments ?? p.input ?? p.action ?? "";
      let input = raw;
      if (typeof raw === "string") {
        try {
          input = JSON.parse(raw);
        } catch {
          input = raw;
        }
      }
      if (p.name === "update_plan" && input && typeof input === "object") {
        const marks = { completed: "[x]", in_progress: "[~]", pending: "[ ]" };
        const steps = (input.plan || []).map((s) => `- ${marks[s.status] || "[ ]"} ${s.step || ""}`).join("\n");
        turns.push({ kind: "plan", text: `${input.explanation || ""}\n\n${steps}`.trim(), approved: null });
        continue;
      }
      const text = typeof input === "string" ? input : describeToolInput(input);
      for (const m of text.matchAll(PATCH_FILE)) files.add(m[1]);
      turns.push({ kind: "tool_call", name: p.name || "tool", text });
    } else if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
      let out = p.output;
      if (out && typeof out === "object" && !Array.isArray(out)) out = out.content ?? out.output ?? JSON.stringify(out);
      turns.push({ kind: "tool_result", text: contentText(out), error: false });
    }
  }
  return { meta, turns, files };
}
