import fs from "node:fs";
import path from "node:path";
import type { Info, StopCode } from "./model.ts";
import { HOME, mtime } from "./util.ts";

/** A saved hand-over, as `baton list` knows it. Older or foreign files may lack some fields. */
export interface Entry extends Partial<Info> {
  file: string;
  title: string;
  created: string;
}

export function storeDir(): string {
  return process.env.BATON_DIR || path.join(HOME, ".baton");
}

export function save(markdown: string, info: Pick<Info, "project" | "created">, dir = storeDir()): string {
  fs.mkdirSync(dir, { recursive: true });
  const slug = info.project.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "session";
  const stamp = info.created.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  let file = path.join(dir, `${slug}-${stamp}.md`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${slug}-${stamp}-${n}.md`);
  fs.writeFileSync(file, markdown);
  return file;
}

function readInfo(file: string): Omit<Entry, "file"> {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const m = buf.subarray(0, n).toString("utf8").match(/^<!-- baton (\{.*?\}) -->/);
    if (m) {
      const info = JSON.parse(m[1]);
      if (typeof info.title === "string" && typeof info.created === "string") return info;
    }
  } catch {
    // Not a baton file, or an older format; fall back to the file name below.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return { title: path.basename(file, ".md"), created: new Date(mtime(file)).toISOString() };
}

/** Saved hand-overs, newest first. */
export function list(dir = storeDir()): Entry[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  return names
    .map((f) => ({ ...readInfo(path.join(dir, f)), file: path.join(dir, f) }))
    .sort((a, b) => b.created.localeCompare(a.created));
}

export function localDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const haystack = (e: Entry) => [e.title, e.project, localDate(e.created), e.source, path.basename(e.file)].join(" ").toLowerCase();
const position = (entries: Entry[], selector: string) =>
  /^\d+$/.test(selector) && Number(selector) >= 1 && Number(selector) <= entries.length ? Number(selector) - 1 : -1;

/**
 * Resolve a selector to one hand-over: nothing = the latest, a small number =
 * its position in `baton list`, anything else = the newest whose title,
 * project, date or source contains the text.
 */
export function select(entries: Entry[], selector?: string): { entry: Entry | null; matches: number } {
  if (!entries.length) return { entry: null, matches: 0 };
  if (!selector) return { entry: entries[0], matches: 1 };
  const i = position(entries, selector);
  if (i >= 0) return { entry: entries[i], matches: 1 };
  const hits = entries.filter((e) => haystack(e).includes(selector.toLowerCase()));
  return { entry: hits[0] ?? null, matches: hits.length };
}

/** Like `select`, but every match, for `baton clean`. */
export function selectAll(entries: Entry[], selector: string): Entry[] {
  const i = position(entries, selector);
  if (i >= 0) return [entries[i]];
  return entries.filter((e) => haystack(e).includes(selector.toLowerCase()));
}

/** Days to keep hand-overs before `baton` cleans them up; BATON_KEEP_DAYS=0 keeps them forever. */
export function keepDays(): number {
  const v = process.env.BATON_KEEP_DAYS;
  const n = v == null || v === "" ? 30 : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

export function isOld(entry: Entry, days = keepDays(), now = Date.now()): boolean {
  return days > 0 && now - Date.parse(entry.created) > days * 86_400_000;
}

/** Delete these hand-overs; returns how many were removed. */
export function remove(entries: Entry[]): number {
  let n = 0;
  for (const e of entries) {
    try {
      fs.unlinkSync(e.file);
      n++;
    } catch {
      // Already gone.
    }
  }
  return n;
}

export const STATUS_LABELS: Record<StopCode, string> = {
  "out-of-usage": "ran out of usage",
  error: "stopped on an error",
  "mid-task": "stopped mid-task",
  unanswered: "unanswered",
  finished: "finished",
};

/** One line of `baton list`. */
export function describe(e: Entry, i: number): string {
  const status = e.status ? STATUS_LABELS[e.status] : "";
  return `${String(i + 1).padStart(2)}  ${localDate(e.created)}  ${(e.project || "").padEnd(18).slice(0, 18)}  ${e.title}${status ? `  · ${status}` : ""}`;
}
