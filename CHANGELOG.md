# Changelog

## 0.3.1 — 2026-09-28

- Choose the unlocked account with the most usage remaining. Cogenity’s recommendation breaks ties.
- Automatically switch to an available account on the other provider when every account on the requested provider is exhausted, without an interactive confirmation.
- Stop with an explanation if both providers are exhausted. Use `--account <email>` to explicitly select an account anyway.

## 0.3.0 — 2026-09-28

- Add `baton setup` to install the shell hook for switching agents in the same terminal window.
- Support removing the hook with `baton setup --undo` and installing without a prompt with `--yes`.

## 0.2.0 — 2026-09-28

- Add `baton claude`, `baton codex`, and `baton next` to save a hand-over and launch the next agent.
- Integrate Cogenity account availability and support switching in the same window through a shell hook.

## 0.1.0

- Initial npm release as `baton-ai`: save Claude Code and Codex conversations as portable Markdown hand-overs.
- Include session context, instructions, and unfinished changes, with commands to select and clean up saved hand-overs.
