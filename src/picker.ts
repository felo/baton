import type { Terminal } from "./terminal.ts";

export interface PickerOptions<T> {
  title?: string;
  /** Checkbox mode: space toggles, ctrl-a toggles everything shown, enter confirms. */
  multi?: boolean;
  checked?: Iterable<T>;
  /** Rows shown at once. */
  visible?: number;
}

export interface Picker<T> {
  items: T[];
  label: (item: T) => string;
  title: string;
  multi: boolean;
  visible: number;
  query: string;
  cursor: number;
  top: number;
  selected: Set<T>;
}

export const KEYS = { up: "\x1b[A", down: "\x1b[B", enter: "\r", escape: "\x1b", ctrlC: "\x03", ctrlA: "\x01", backspace: "\x7f", space: " " };

export function createPicker<T>(items: T[], label: (item: T) => string, opts: PickerOptions<T> = {}): Picker<T> {
  return {
    items,
    label,
    title: opts.title ?? "Pick a hand-over",
    multi: !!opts.multi,
    visible: Math.max(1, Math.min(opts.visible ?? 12, items.length)),
    query: "",
    cursor: 0,
    top: 0,
    selected: new Set(opts.checked ?? []),
  };
}

export function shown<T>(p: Picker<T>): T[] {
  const q = p.query.toLowerCase();
  return p.items.filter((it) => p.label(it).toLowerCase().includes(q));
}

/**
 * Apply one key. Returns undefined while picking; when done, `{ value }`:
 * the chosen item (single), the checked items (multi), or null if cancelled.
 */
export function press<T>(p: Picker<T>, key: string): { value: T | T[] | null } | undefined {
  const rows = shown(p);
  switch (key) {
    case KEYS.ctrlC:
    case KEYS.escape:
      return { value: null };
    case KEYS.enter:
    case "\n":
      return { value: p.multi ? p.items.filter((it) => p.selected.has(it)) : (rows[p.cursor] ?? null) };
    case KEYS.up:
    case "\x1bOA":
    case "\x10":
      p.cursor = Math.max(0, p.cursor - 1);
      break;
    case KEYS.down:
    case "\x1bOB":
    case "\x0e":
      p.cursor = Math.min(Math.max(0, rows.length - 1), p.cursor + 1);
      break;
    case KEYS.backspace:
    case "\b":
      p.query = p.query.slice(0, -1);
      p.cursor = 0;
      break;
    default:
      if (p.multi && key === KEYS.space) {
        const it = rows[p.cursor];
        if (it !== undefined) p.selected.has(it) ? p.selected.delete(it) : p.selected.add(it);
      } else if (p.multi && key === KEYS.ctrlA) {
        const all = rows.every((it) => p.selected.has(it));
        for (const it of rows) all ? p.selected.delete(it) : p.selected.add(it);
      } else if (key >= " " && !key.startsWith("\x1b")) {
        p.query += key;
        p.cursor = 0;
      }
  }
  return undefined;
}

/** The picker's screen lines. */
export function view<T>(p: Picker<T>, columns = 100): string[] {
  const rows = shown(p);
  p.cursor = Math.min(p.cursor, Math.max(0, rows.length - 1));
  if (p.cursor < p.top) p.top = p.cursor;
  if (p.cursor >= p.top + p.visible) p.top = p.cursor - p.visible + 1;
  const help = p.multi
    ? "↑↓ move · space select · ctrl-a all · type to filter · enter confirm · esc cancel"
    : "↑↓ move · type to filter · enter choose · esc cancel";
  const count = p.multi ? `  \x1b[2m${p.selected.size} selected\x1b[0m` : "";
  const lines = [`\x1b[1m${p.title}\x1b[0m${count}  \x1b[2m${help}\x1b[0m`, `\x1b[36m›\x1b[0m ${p.query}`];
  for (let i = p.top; i < p.top + p.visible; i++) {
    const it = rows[i];
    if (it === undefined) {
      lines.push(i === 0 ? "  \x1b[2mno matches\x1b[0m" : "");
      continue;
    }
    const box = p.multi ? (p.selected.has(it) ? "\x1b[32m◉\x1b[0m " : "○ ") : "";
    const text = p.label(it).slice(0, columns - 8);
    lines.push(i === p.cursor ? `\x1b[36m❯\x1b[0m ${box}\x1b[1m${text}\x1b[0m` : `  ${box}${text}`);
  }
  return lines;
}

/** Run a picker on the terminal until the user chooses or cancels. */
export function pick<T>(term: Terminal, items: T[], label: (item: T) => string, opts: PickerOptions<T> = {}): Promise<T | T[] | null> {
  const p = createPicker(items, label, opts);
  let drawn = 0;
  const draw = () => {
    const lines = view(p, term.columns);
    term.write((drawn ? `\x1b[${drawn}A` : "") + lines.map((l) => `\r\x1b[2K${l}`).join("\n") + "\n");
    drawn = lines.length;
  };
  return new Promise((resolve) => {
    term.write("\x1b[?25l");
    term.onKey((key) => {
      const done = press(p, key);
      if (!done) return draw();
      term.onKey(null);
      term.write(`\x1b[${drawn}A\x1b[0J\x1b[?25h`);
      resolve(done.value);
    });
    draw();
  });
}

/** Only "y" or "yes" counts as yes; anything else, including just enter, is no. */
export const isYes = (answer: string): boolean => /^y(es)?$/i.test(answer.trim());

/** Ask a yes/no question on the terminal. Defaults to no. */
export function confirm(term: Terminal, question: string): Promise<boolean> {
  term.write(`${question} \x1b[2m[y/N]\x1b[0m `);
  let answer = "";
  return new Promise((resolve) => {
    term.onKey((key) => {
      if (key === KEYS.ctrlC || key === KEYS.escape) key = KEYS.enter;
      if (key === KEYS.enter || key === "\n") {
        term.onKey(null);
        term.write("\n");
        return resolve(isYes(answer));
      }
      if (key === KEYS.backspace || key === "\b") {
        if (answer) term.write("\b \b");
        answer = answer.slice(0, -1);
      } else if (key >= " " && !key.startsWith("\x1b")) {
        answer += key;
        term.write(key);
      }
    });
  });
}
