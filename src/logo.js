// The baton wordmark, with a light sweep that runs through it like a baton
// being passed: Claude orange on the left fading to Codex blue on the right.

export const LOGO = [
  "██████   █████  ████████  ██████  ███    ██",
  "██   ██ ██   ██    ██    ██    ██ ████   ██",
  "██████  ███████    ██    ██    ██ ██ ██  ██",
  "██   ██ ██   ██    ██    ██    ██ ██  ██ ██",
  "██████  ██   ██    ██     ██████  ██   ████",
  "◖━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◗",
];
export const TAGLINE = "pass it on.";

const FROM = [217, 119, 87]; // orange
const TO = [80, 140, 255]; // blue
const WIDTH = LOGO[0].length;
const BAND = 6; // half-width of the bright band, in columns
const FRAME_MS = 22;

const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function ansi256([r, g, b]) {
  const q = (v) => Math.round((v / 255) * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

function colorizer() {
  const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM || "");
  return (rgb) => (truecolor ? `\x1b[38;2;${rgb.join(";")}m` : `\x1b[38;5;${ansi256(rgb)}m`);
}

/** Whether the terminal can show the animated logo. Pipes, agents and NO_COLOR get nothing. */
export function canAnimate(stream = process.stdout) {
  return !!stream.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb" && !process.env.CI;
}

/** One frame with the band centred on column `at` (past the end = the settled logo). */
function frame(at, color) {
  const lines = LOGO.map((line) => {
    let out = "";
    let last = "";
    [...line].forEach((ch, col) => {
      if (ch === " ") {
        out += " ";
        return;
      }
      const base = lerp(FROM, TO, col / (WIDTH - 1));
      const d = at - col; // > 0 once the band has passed this column
      let rgb;
      if (d > BAND) rgb = base;
      else if (d < -BAND) rgb = lerp([40, 40, 48], base, 0.25); // not reached yet: dim
      else rgb = lerp(base, [255, 255, 255], 1 - Math.abs(d) / BAND); // inside the band: glow
      const code = color(rgb);
      if (code !== last) out += code;
      last = code;
      out += ch;
    });
    return out + "\x1b[0m";
  });
  const pad = " ".repeat(Math.floor((WIDTH - TAGLINE.length) / 2));
  lines.push(`\x1b[2m${pad}${TAGLINE}\x1b[0m`);
  return lines;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Play the sweep once, then leave the settled logo on screen. */
export async function showLogo(stream = process.stdout) {
  if (!canAnimate(stream)) return;
  const color = colorizer();
  const height = LOGO.length + 1;
  const restore = () => stream.write("\x1b[?25h");
  process.once("exit", restore);
  stream.write("\x1b[?25l\n");
  for (let at = -BAND; at <= WIDTH + BAND; at += 2) {
    if (at > -BAND) stream.write(`\x1b[${height}A`);
    stream.write(frame(at, color).map((l) => `\r\x1b[2K  ${l}`).join("\n") + "\n");
    await sleep(FRAME_MS);
  }
  stream.write("\n");
  restore();
  process.removeListener("exit", restore);
}
