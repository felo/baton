import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "..");
export const fixture = (name: string): string => path.join(here, "fixtures", name);
export const tmp = (): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "baton-")));

/** Write a minimal saved hand-over, the way `baton list` reads them. */
export function handover(dir: string, name: string, info: { title: string; project: string; created: string; status?: string }): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.md`);
  fs.writeFileSync(file, `<!-- baton ${JSON.stringify(info)} -->\n# Hand-over: ${info.title}\n`);
  return file;
}

export const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();
