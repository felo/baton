import fs from "node:fs";
import os from "node:os";

export const HOME = os.homedir();

const SECRET_PATTERNS = [
  /sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{30,}/g,
  /github_pat_[A-Za-z0-9_]{30,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g,
  /((?:api[_-]?key|secret|token|password)\s*[=:]\s*)['"]?[^\s'"]{12,}/gi,
];

/** Replace likely API keys and tokens with [REDACTED]. Pattern-matching, not a guarantee. */
export function redact(s) {
  for (const p of SECRET_PATTERNS) {
    s = s.replace(p, (_m, prefix) => (typeof prefix === "string" ? prefix : "") + "[REDACTED]");
  }
  return s;
}

export function clip(s, n, full) {
  s = s.trim();
  if (full || s.length <= n) return s;
  return s.slice(0, n) + `\n… [${s.length - n} more characters cut]`;
}

export function stripNoise(s) {
  return s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
}

/** Wrap text in a code fence long enough that nothing inside can close it. */
export function fence(s, lang = "") {
  const longest = Math.max(0, ...(s.match(/`{3,}/g) || []).map((m) => m.length));
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${s}\n${ticks}`;
}

export function firstLine(s, n = 200) {
  const line = s.trim().split("\n").find((l) => l.trim()) || "";
  return line.length > n ? line.slice(0, n) + "…" : line;
}

export function* readJsonl(file) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // Half-written last line while the session is live; skip it.
    }
  }
}

/** Parse only the start of a transcript: enough to find its working directory without reading megabytes. */
export function readJsonlHead(file, bytes = 256 * 1024) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    const out = [];
    for (const line of buf.subarray(0, n).toString("utf8").split("\n")) {
      try {
        out.push(JSON.parse(line));
      } catch {
        // The last line is usually cut mid-way.
      }
    }
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

/** Flatten a message's content (string or list of blocks) into plain text. */
export function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (c && typeof c === "object") {
          if (["text", "input_text", "output_text"].includes(c.type)) return c.text || "";
          if (["image", "input_image"].includes(c.type)) return "[image]";
          return "";
        }
        return String(c);
      })
      .join("\n");
  }
  return content == null ? "" : JSON.stringify(content);
}

/** One readable string for a tool call's input: the main argument first, the rest as JSON. */
export function describeToolInput(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const key of ["command", "cmd", "file_path", "path", "pattern", "url", "query", "prompt", "skill"]) {
      if (typeof input[key] === "string") {
        const { [key]: head, ...rest } = input;
        return head + (Object.keys(rest).length ? "\n" + JSON.stringify(rest) : "");
      }
    }
    return JSON.stringify(input, null, 1);
  }
  return String(input ?? "");
}

export function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function mtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}
