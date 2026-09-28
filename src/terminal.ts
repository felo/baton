import fs from "node:fs";
import tty from "node:tty";

/**
 * The keyboard and screen, opened once through /dev/tty so pickers work even
 * inside `$(baton take)` where stdout is captured. One Terminal is shared by
 * every prompt in a command: closing and reopening /dev/tty between two prompts
 * can lose keys typed in between.
 */
export interface Terminal {
  write(s: string): void;
  /** Receive keys one at a time (a pasted word arrives as separate letters). Pass null to stop. */
  onKey(handler: ((key: string) => void) | null): void;
  columns: number;
  close(): void;
}

/** Whether someone is at a keyboard. Agents' shells and pipes have no terminal on stdin. */
export function interactive(): boolean {
  if (!process.stdin.isTTY) return false;
  try {
    fs.closeSync(fs.openSync("/dev/tty", "r+"));
    return true;
  } catch {
    return false;
  }
}

/** Split a chunk of terminal input into keys: escape sequences stay whole, everything else is one character. */
export function splitKeys(chunk: string): string[] {
  return chunk.match(/\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]|[\s\S]/gu) ?? [];
}

export function openTerminal(): Terminal {
  const fd = fs.openSync("/dev/tty", "r+");
  const input = new tty.ReadStream(fd);
  const write = (s: string) => void fs.writeSync(fd, s);
  let handler: ((key: string) => void) | null = null;
  input.setRawMode(true);
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    for (const key of splitKeys(chunk)) handler?.(key);
  });
  const restore = () => write("\x1b[?25h");
  process.once("exit", restore);
  return {
    write,
    onKey: (h) => {
      handler = h;
    },
    columns: process.stderr.columns || 100,
    close: () => {
      restore();
      process.removeListener("exit", restore);
      input.setRawMode(false);
      input.destroy();
    },
  };
}
