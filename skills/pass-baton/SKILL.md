---
name: pass-baton
description: Save this coding session as a hand-over file another agent (Claude Code, Codex or any other) can continue from. Use when the user wants to hand over, pass the baton, switch agents or accounts, save context for later, or is about to run out of tokens or usage.
---

# Pass the baton

Save the current session with [baton](https://github.com/felo/baton) so another agent can pick it up. The tool reads the session transcript from disk; it uses no AI and no network.

## Steps

1. If you are in the middle of something, first tell the user in one or two sentences where you are: what's done, what's left. That sentence becomes part of the hand-over.

2. Run it from the project's working directory:

   ```sh
   if command -v baton >/dev/null; then baton; else npx -y agent-baton; fi
   ```

   Useful options, only when the user asks for them:
   - `--out <dir>` to save somewhere specific (default `~/.baton/`)
   - `--full` to keep long command output whole
   - `--no-diff` to leave out the uncommitted code changes

3. Tell the user where it was saved and how to continue, using the commands the tool printed. Typically:

   ```sh
   claude "$(baton take)"
   codex "$(baton take)"
   ```

   (With `npx -y agent-baton take` in place of `baton take` if it isn't installed.)

## Notes

- Everything written up to now is included: the conversation, commands and results, the user's instruction files, the latest plan, and every uncommitted change as a patch.
- Likely secrets are redacted, but only by pattern. If the user plans to share the file with someone else, suggest they skim it first.
- Don't open or summarise the saved file unless asked; it can be large.
