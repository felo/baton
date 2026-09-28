import fs from "node:fs";
import path from "node:path";
import { HOME, mtime } from "./util.js";

export function storeDir() {
  return process.env.BATON_DIR || path.join(HOME, ".baton");
}

export function save(markdown, info, dir = storeDir()) {
  fs.mkdirSync(dir, { recursive: true });
  const slug = info.project.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "session";
  const stamp = info.created.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  let file = path.join(dir, `${slug}-${stamp}.md`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${slug}-${stamp}-${n}.md`);
  fs.writeFileSync(file, markdown);
  return file;
}

function readInfo(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const m = buf.subarray(0, n).toString("utf8").match(/^<!-- baton (\{.*?\}) -->/);
    if (m) return JSON.parse(m[1]);
  } catch {
    // Not a baton file, or an older format; fall back to the file name below.
  } finally {
    fs.closeSync(fd);
  }
  return { title: path.basename(file, ".md"), project: "", source: "", status: "", created: new Date(mtime(file)).toISOString() };
}

/** Saved hand-overs, newest first. */
export function list(dir = storeDir()) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  return names
    .map((f) => ({ file: path.join(dir, f), ...readInfo(path.join(dir, f)) }))
    .sort((a, b) => b.created.localeCompare(a.created));
}

export function localDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Resolve a selector to one hand-over: nothing = the latest, a small number =
 * its position in `baton list`, anything else = the newest whose title,
 * project, date or source contains the text.
 */
export function select(entries, selector) {
  if (!entries.length) return { entry: null, matches: 0 };
  if (selector == null || selector === "") return { entry: entries[0], matches: 1 };
  if (/^\d+$/.test(selector) && Number(selector) >= 1 && Number(selector) <= entries.length) {
    return { entry: entries[Number(selector) - 1], matches: 1 };
  }
  const needle = selector.toLowerCase();
  const hits = entries.filter((e) => [e.title, e.project, localDate(e.created), e.source, path.basename(e.file)].join(" ").toLowerCase().includes(needle));
  return { entry: hits[0] || null, matches: hits.length };
}

export const STATUS_LABELS = {
  "out-of-usage": "ran out of usage",
  error: "stopped on an error",
  "mid-task": "stopped mid-task",
  unanswered: "unanswered",
  finished: "finished",
};
