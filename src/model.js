/**
 * The shared shape both parsers produce.
 *
 * meta:  { title, models:Set, first, last, cwd, branch, settings:{name: [values in order]} }
 * turns: [{ kind, ... }] where kind is one of
 *   user, assistant       { text }
 *   tool_call             { name, text }
 *   tool_result           { text, error }
 *   thought               { text }   short label for a reasoning step (Codex)
 *   plan                  { text, approved: true | false | null }
 *   notice                { text }   automatic message, not typed by the user
 *   error                 { text, code }   usage limit or API error
 *   summary               { text }   compacted earlier context
 * files: Set of paths the agent edited
 */
export function newMeta() {
  return { title: null, models: new Set(), first: null, last: null, cwd: null, branch: null, settings: {} };
}

/** Record a session setting; keeps each distinct value once, in order, so changes read "a → b". */
export function note(meta, key, value) {
  if (value == null || value === "") return;
  const vals = (meta.settings[key] ||= []);
  if (vals[vals.length - 1] !== value) vals.push(value);
}

/** A message that is entirely one <tag>…</tag> block: injected by the harness, not typed by a person. */
export const INJECTED = /^\s*<([a-z][a-z_-]*)[^>]*>[\s\S]*<\/\1>\s*$/;
