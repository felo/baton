import fs from "node:fs";
import tty from "node:tty";

/**
 * Arrow-key picker drawn on the terminal itself (/dev/tty), so it still works
 * inside `$(baton pick)` where stdout is captured. Type to filter.
 * Resolves to the chosen item, or null if cancelled.
 */
export function pick(items, label) {
  let fd;
  try {
    fd = fs.openSync("/dev/tty", "r+");
  } catch {
    return Promise.reject(new Error("baton pick needs an interactive terminal. Use `baton list` and `baton take <number>` instead."));
  }
  const input = new tty.ReadStream(fd);
  const write = (s) => fs.writeSync(fd, s);
  const visible = Math.min(12, items.length);
  let query = "";
  let cursor = 0;
  let top = 0;
  let drawn = 0;

  const filtered = () => items.filter((it) => label(it).toLowerCase().includes(query.toLowerCase()));

  const draw = () => {
    const rows = filtered();
    cursor = Math.min(cursor, Math.max(0, rows.length - 1));
    if (cursor < top) top = cursor;
    if (cursor >= top + visible) top = cursor - visible + 1;
    const cols = process.stderr.columns || 100;
    const lines = [`\x1b[1mPick a hand-over\x1b[0m  \x1b[2m↑↓ move · type to filter · enter to choose · esc to cancel\x1b[0m`, `> ${query}`];
    for (let i = top; i < top + visible; i++) {
      const it = rows[i];
      if (!it) {
        lines.push("");
        continue;
      }
      const text = label(it).slice(0, cols - 4);
      lines.push(i === cursor ? `\x1b[7m ${text} \x1b[0m` : `  ${text}`);
    }
    if (drawn) write(`\x1b[${drawn}A`);
    write(lines.map((l) => `\r\x1b[2K${l}`).join("\n") + "\n");
    drawn = lines.length;
  };

  return new Promise((resolve) => {
    const done = (value) => {
      write(`\x1b[${drawn}A\x1b[0J`);
      input.setRawMode(false);
      input.pause();
      input.destroy();
      resolve(value);
    };
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.on("data", (key) => {
      const rows = filtered();
      if (key === "\x03" || key === "\x1b") return done(null);
      if (key === "\r" || key === "\n") return done(rows[cursor] || null);
      if (key === "\x1b[A" || key === "\x10") cursor = Math.max(0, cursor - 1);
      else if (key === "\x1b[B" || key === "\x0e") cursor = Math.min(rows.length - 1, cursor + 1);
      else if (key === "\x7f" || key === "\b") query = query.slice(0, -1);
      else if (key >= " " && !key.startsWith("\x1b")) {
        query += key;
        cursor = 0;
      }
      draw();
    });
    draw();
  });
}
