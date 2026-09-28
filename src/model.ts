/** Which agent wrote a transcript. */
export type Tool = "claude" | "codex";

/** One step of a conversation, in the shape both parsers produce. */
export type Turn =
  | { kind: "user" | "assistant"; text: string }
  | { kind: "tool_call"; name: string; text: string }
  | { kind: "tool_result"; text: string; error: boolean }
  /** A short label for a reasoning step (Codex keeps these; the reasoning itself is encrypted). */
  | { kind: "thought"; text: string }
  /** approved: true or false once the user answered, null for the agent's own checklist. */
  | { kind: "plan"; text: string; approved: boolean | null }
  /** An automatic message from the tool, not typed by the user. */
  | { kind: "notice"; text: string }
  /** A usage limit or API error that cut the agent off. */
  | { kind: "error"; text: string; code: string | null }
  /** Earlier context, summarised when the session was compacted. */
  | { kind: "summary"; text: string };

export interface Meta {
  title: string | null;
  models: Set<string>;
  first: string | null;
  last: string | null;
  cwd: string | null;
  branch: string | null;
  /** Setting name → each distinct value in order, so changes read "a → b". */
  settings: Record<string, string[]>;
}

export interface Parsed {
  meta: Meta;
  turns: Turn[];
  /** Paths the agent edited. */
  files: Set<string>;
}

export interface Session extends Parsed {
  file: string;
  tool: Tool;
}

export type StopCode = "out-of-usage" | "error" | "mid-task" | "unanswered" | "finished";

/** What `baton list` shows; stored as a comment on the first line of each hand-over. */
export interface Info {
  title: string;
  project: string;
  cwd: string;
  source: Tool;
  status: StopCode;
  created: string;
  userMessages: number;
}

export function newMeta(): Meta {
  return { title: null, models: new Set(), first: null, last: null, cwd: null, branch: null, settings: {} };
}

/** Record a session setting; keeps each distinct value once, in order. */
export function note(meta: Meta, key: string, value: unknown): void {
  if (value == null || value === "") return;
  const vals = (meta.settings[key] ||= []);
  const v = String(value);
  if (vals[vals.length - 1] !== v) vals.push(v);
}

/** A message that is entirely one <tag>…</tag> block: injected by the harness, not typed by a person. */
export const INJECTED = /^\s*<([a-z][a-z_-]*)[^>]*>[\s\S]*<\/\1>\s*$/;
