# baton

**Pass your AI coding session to the next agent.**

Your agent ran out of tokens halfway through a task. Or you want Codex to finish what Claude started. Either way, the new agent starts from zero, and you end up explaining everything again.

`baton` fixes that with one command. It saves your session as a single file the next agent reads to continue exactly where the last one stopped, whatever the model.

```sh
npx agent-baton
```

No AI involved, so it works even when you're out of tokens.

---

## How it works

**1. Save the session.** Inside Claude Code, type:

```
! npx agent-baton
```

(Or run `npx agent-baton` in a terminal, from the project folder.)

**2. Start the next agent on it:**

```sh
claude "$(npx agent-baton take)"
codex "$(npx agent-baton take)"
```

That's it. The new agent reads the hand-over and carries on.

> Install it once with `npm i -g agent-baton` and every command above is just `baton`.

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
| `baton list` | Your saved hand-overs, newest first |
| `baton take` | A "read this and continue" prompt for the latest one |
| `baton take 3` | …for number 3 in the list |
| `baton take checkout` | …for the newest whose title, project or date matches |
| `baton pick` | Choose one with the arrow keys |

Useful options:

- `--content` prints the whole hand-over instead of the prompt.
- `--path` prints only the file path.
- `--out <dir>` saves somewhere other than `~/.baton`.
- `--stdout` prints instead of saving.
- `--full` keeps long command output whole.
- `--no-diff` leaves out your uncommitted code.
- `--session <id>` hands over a specific session instead of the current one.
- `--tool claude|codex` only looks at one tool's sessions.

## Works with

- **Claude Code**
- **Codex**
- Multiple accounts (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, Cogenity)

Hand-overs go both ways: Claude → Codex, Codex → Claude, Claude → Claude on another account. The file is plain Markdown, so any agent that can read a file can pick it up.

## Private by default

- Everything stays on your machine. `baton` never touches the network.
- Hand-overs are saved in `~/.baton/`, outside your project, so they're never committed by accident.
- Likely API keys and tokens are replaced with `[REDACTED]`. That's pattern matching, not a guarantee, so skim a file before you share it with anyone.

## Good to know

- An agent's private reasoning is encrypted by both tools, so it can't be carried over. Everything it said and did is.
- Sub-agents' side conversations are left out; their results are included.

## Requirements

Node.js 18 or newer. No dependencies.

## License

MIT
