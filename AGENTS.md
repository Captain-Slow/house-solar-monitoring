# Agent rules for this repository

## Files stay inside the repository

Never create, write, copy or leave files outside this repository (for example under `D:\`, `D:\Github\` beside the repo,
`%TEMP%`, `%LOCALAPPDATA%`, or the home directory) unless the owner gives explicit permission for that specific
location in the current conversation. Default to the repository:

- Tracked evidence reports, findings, audits, reviews and decision records: `docs/` (existing homes:
  `docs/ui-audit/`, `docs/design/redesign/`, `docs/operations.md`, `docs/field-mapping.md`). Commit them.
- Raw, bulky or regenerable evidence (captures, screenshots, review JSON, probe output, harness and scratch files):
  `captures/local/` (gitignored). Anything that must survive a fresh clone belongs in `docs/` instead, and any
  gitignored artifact that docs cite must be listed in `TODO.md` section G.
- Backups of files you delete or purge: do not create them outside the repo. Ask first, or keep the content in git
  history or `captures/local/`.
- Scratch and temporary files: `captures/local/` (or a subdirectory of it). Delete them when the task ends.
- Secrets, credentials and tokens are never written to the repo, to chat or to logs. Follow `docs/operations.md`.

If a tool or subagent forces a path outside the repo (for example a harness scratchpad), say so, keep it to the minimum
and list what was left behind and where in the final report.

## Known artifacts outside the repo

These pre-date this rule and are kept on purpose (see `TODO.md` section G):

- Mockup frames, batches 1-12 (about 520 MB): `%LOCALAPPDATA%/Temp/claude/D--Github-house-solar-monitoring/5dcbc0dc-0edb-442c-9d0f-8da73cadad4b/scratchpad/`.
  Owner decision 2026-11-10: leave in place; do not delete or move without asking.
