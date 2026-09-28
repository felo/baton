<p align="center"><img src="assets/logo.svg" alt="baton" width="560"></p>

<p align="center"><b>Pass your AI coding session to the next agent.</b></p>

Your agent ran out of tokens halfway through a task. Or you want Codex to finish what Claude started. Either way, the new agent starts from zero, and you end up explaining everything again.

`baton` fixes that with one command. It saves your session as a single file the next agent reads to continue exactly where the last one stopped, whatever the model.

```sh
npx baton-ai
```

No AI involved, so it works even when you're out of tokens.

---

## How it works

**1. Save the session.** Inside Claude Code, type:

```
! npx baton-ai
```

(Or run `npx baton-ai` in a terminal, from the project folder.)

**2. Start the next agent on it:**

```sh
claude "$(npx baton-ai take)"
codex "$(npx baton-ai take)"
```

That's it. The new agent reads the hand-over and carries on.

> Install it once with `npm i -g baton-ai` and every command above is just `baton`.

### Or switch in one go

```sh
baton codex        # save this session and start Codex on it
baton claude       # …or Claude Code
baton next         # …or whichever has the most usage left
```

From a terminal, the next agent starts right there. From inside a chat, type `! baton codex`: baton closes the current agent and starts the next one in the same window. For that, add this line to your `~/.zshrc` (or `~/.bashrc`, with `bash`) once:

```sh
eval "$(baton init zsh)"
```

Without it, baton opens the next agent in a new tab (Terminal and iTerm) or prints the command to run.

**With [Cogenity](https://github.com/kennethlynne/cogenity)**, the next agent starts on the account with the most room left. Out of tokens on one Claude account? `! baton claude` carries on with another. If every account for that tool is used up, baton says when they reset and offers the other tool instead.

### Or just ask your agent

Add the skills once:

```sh
npx skills add felo/baton              # Claude Code, Codex, Cursor and others
```

In Claude Code you can install it as a plugin instead:

```
/plugin marketplace add felo/baton
/plugin install baton@baton
```

Then say **"pass the baton"** to save, and **"take the baton"** in the new chat to pick up where it left off. The new agent reads the hand-over, checks your code, tells you what it's picking up, and carries on.

> Already out of tokens? Use the command above instead: it needs no AI, so it still works.

---

## What the next agent gets

One Markdown file, written to be read top to bottom:

- **A briefing.** Why the last agent stopped (ran out of usage, hit an error, stopped mid-task, or finished), what it did last, and what you asked for.
- **Your rules.** The `CLAUDE.md` / `AGENTS.md` files and saved memories the last agent was following, so the new one works the way you expect.
- **The plan.** The last plan you approved, in full.
- **The code.** Branch, recent commits, and every uncommitted change as a patch it can apply, so it works even on another machine.
- **The whole conversation.** Every message, every command it ran and what came back, plus Codex's step-by-step labels of what it was thinking.

## Commands

| | |
|---|---|
| `baton` | Save the session you're in |
| `baton take` | Pick a hand-over with the arrow keys, and get a "read this and continue" prompt for it |
| `baton take 3` | Skip the picker: number 3 in the list |
| `baton take checkout` | Skip the picker: the newest whose title, project or date matches |
| `baton list` | Your saved hand-overs, newest first |
| `baton clean` | Tick what to delete (anything over 30 days old is pre-ticked), then confirm |
| `baton flush` | Delete them all, after a y/N check |
| `baton codex` / `baton claude` | Save this session and start that agent on it |
| `baton next` | Same, with whichever agent has the most usage left (Cogenity) |
| `baton init zsh` | The shell hook that lets `! baton codex` switch in place |

When an agent runs `baton take` there's no keyboard, so it gets the latest one straight away.

Useful options:

- `--latest` skips the picker and takes the newest.
- `--content` prints the whole hand-over instead of the prompt.
- `--path` prints only the file path.
- `--out <dir>` saves somewhere other than `~/.baton`.
- `--stdout` prints instead of saving.
- `--full` keeps long command output whole.
- `--no-diff` leaves out your uncommitted code.
- `--session <id>` hands over a specific session instead of the current one.
- `--tool claude|codex` only looks at one tool's sessions.
- `--yes` deletes without asking, for scripts.
- `--account <email>` starts the next agent on a specific Cogenity account.
- `--yolo` / `--no-yolo` skips permission prompts in the next agent, or doesn't. By default it matches the previous one.
- `--dry-run` shows what `baton codex` would do without doing it.

Hand-overs older than 30 days are tidied up automatically each time you save. Set `BATON_KEEP_DAYS` to change that, or `0` to keep them forever.

## Works with

- **Claude Code**
- **Codex**
- Multiple accounts: custom `CLAUDE_CONFIG_DIR` / `CODEX_HOME`, and [Cogenity](https://github.com/kennethlynne/cogenity) by [Kenneth Lynne](https://github.com/kennethlynne), whose chats `baton` finds on every account automatically

Hand-overs go both ways: Claude → Codex, Codex → Claude, Claude → Claude on another account. The file is plain Markdown, so any agent that can read a file can pick it up.

## Private by default

- Everything stays on your machine. `baton` never touches the network.
- Hand-overs are saved in `~/.baton/`, outside your project, so they're never committed by accident.
- Likely API keys and tokens are replaced with `[REDACTED]`. That's pattern matching, not a guarantee, so skim a file before you share it with anyone.

## Good to know

- An agent's private reasoning is encrypted by both tools, so it can't be carried over. Everything it said and did is.
- Sub-agents' side conversations are left out; their results are included.

## Requirements

Node.js 18 or newer. No runtime dependencies.

## Development

```sh
git clone https://github.com/felo/baton && cd baton
npm install        # also builds
npm run check      # typecheck + tests
npm link           # use your local copy as `baton`
```

Written in TypeScript; tests run straight from the source with Node's built-in test runner (Node 22.18+). The published package is plain JavaScript and runs on Node 18+.

## License

MIT
