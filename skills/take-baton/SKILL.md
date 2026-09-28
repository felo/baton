---
name: take-baton
description: Continue work another AI agent handed over with baton. Use when the user says to take or pick up the baton, continue from a hand-over, take over from another agent or account, or resume where Claude, Codex or another agent stopped.
---

# Take the baton

Pick up a hand-over saved by [baton](https://github.com/felo/baton) and continue the work as if you had been there.

## Steps

1. Find the hand-over file. With no hint from the user, take the latest:

   ```sh
   if command -v baton >/dev/null; then baton take --path; else npx -y agent-baton take --path; fi
   ```

   If the user names one (a project, a title, a date, or a number from the list), pass it: `baton take --path checkout`. Run `baton list` to show the options if it's unclear which one they mean.

2. Read the file. Read the **Briefing** at the top first; it says why the previous agent stopped, what it did last, what the user asked for, and what each section below contains. Then read the sections in order. The file can be large, so read it in chunks rather than all at once, and don't skip the end of the conversation: the latest messages matter most.

3. Before changing anything:
   - Follow the **standing instructions** section. They are the user's rules and still apply.
   - Compare the **repository state** with the live checkout (`git status`, `git log -1`). If the uncommitted work isn't there, the patch at the end of the file restores it: check out the base commit and `git apply` the patch, after asking the user.
   - If something in the file conflicts with what's on disk, trust the disk and say so.

4. Tell the user in two or three sentences what you picked up: the task, where it stopped, and what you'll do next. Then continue, unless the briefing says the previous agent had finished and was waiting for the user; in that case ask what they want next.

## Notes

- Tool names in the file (`Bash`, `Edit`, `exec`…) are the previous agent's. Use your own equivalents.
- Lines marked 💭 are short labels for the previous agent's reasoning; its full reasoning isn't recorded.
- `[REDACTED]` marks a likely secret that was removed. Ask the user for the real value if you need it.
