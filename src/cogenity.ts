// Cogenity (github.com/kennethlynne/cogenity, by Kenneth Lynne) pools several
// Claude Code and Codex accounts. When it's installed, baton asks it which
// account has room and starts the next agent through it.
import { execFileSync } from "node:child_process";
import type { Tool } from "./model.ts";

export interface Bucket {
  name: string;
  utilization?: number;
  resetsAt?: string;
  /** Shown for information; doesn't block the account. */
  displayOnly?: boolean;
}

export interface Account {
  email: string;
  locked?: boolean;
  usage?: { score?: number; buckets?: Bucket[] };
  /** The account Cogenity would launch next for this tool. */
  wouldPick?: boolean;
}

export interface Status {
  schemaVersion: number;
  tools: Partial<Record<Tool, { accounts: Account[] }>>;
}

export interface Choice {
  tool: Tool;
  account: string;
  /** Percent used of the tightest limit, 0–100. */
  used: number;
  exhausted: boolean;
  /** When the limit that's full resets, if exhausted. */
  resetsAt: string | null;
}

const limits = (a: Account) => (a.usage?.buckets ?? []).filter((b) => !b.displayOnly && typeof b.utilization === "number");

/** How used up an account is: its tightest limit, in percent. */
export function usedOf(a: Account): number {
  const ls = limits(a);
  if (ls.length) return Math.max(...ls.map((b) => b.utilization!));
  return a.usage?.score ?? 0;
}

function choice(tool: Tool, a: Account): Choice {
  const used = usedOf(a);
  const full = limits(a).filter((b) => b.utilization! >= 100 && b.resetsAt);
  // The account is usable again only once every full limit has reset.
  const resetsAt = full.length ? full.map((b) => b.resetsAt!).sort().pop()! : null;
  return { tool, account: a.email, used, exhausted: used >= 100, resetsAt };
}

/** The unlocked account with the most room; Cogenity's pick breaks ties. */
export function choose(status: Status, tool: Tool): Choice | null {
  const accounts = (status.tools[tool]?.accounts ?? []).filter((a) => a.email && !a.locked);
  if (!accounts.length) return null;
  const picked = [...accounts].sort((a, b) => usedOf(a) - usedOf(b) || Number(!!b.wouldPick) - Number(!!a.wouldPick))[0];
  return choice(tool, picked);
}

/** The tool with the most room across both, preferring the current one on a tie. */
export function chooseNext(status: Status, current?: Tool): Choice | null {
  const options = (["claude", "codex"] as Tool[]).map((t) => choose(status, t)).filter((c): c is Choice => c !== null);
  if (!options.length) return null;
  return options.sort((a, b) => a.used - b.used || (a.tool === current ? -1 : b.tool === current ? 1 : 0))[0];
}

export function parseStatus(text: string): Status | null {
  try {
    const s = JSON.parse(text);
    if (typeof s?.schemaVersion !== "number" || typeof s.tools !== "object" || !s.tools) return null;
    return s as Status;
  } catch {
    return null;
  }
}

/**
 * Ask Cogenity for its accounts. Null when it isn't installed, is turned off
 * with BATON_NO_COGENITY, or answers in a shape we don't understand; callers
 * then fall back to launching the tool directly or to Cogenity's own picker.
 */
export function readStatus(): Status | null {
  if (process.env.BATON_NO_COGENITY) return null;
  try {
    const out = execFileSync("cogenity", ["status", "--json"], { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] });
    return parseStatus(out);
  } catch {
    return null;
  }
}

/** Whether the cogenity command exists at all (even if status fails). */
export function hasCogenity(): boolean {
  if (process.env.BATON_NO_COGENITY) return false;
  try {
    execFileSync("cogenity", ["--version"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
