// Run tests against an empty home folder, so they never read the machine's real
// transcripts, instruction files or saved hand-overs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "baton-home-"));
for (const v of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "BATON_DIR", "CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID"]) delete process.env[v];
