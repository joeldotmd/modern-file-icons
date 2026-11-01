# Change Discipline

## Stay within scope

A direct implementation request authorizes normal changes needed to finish that task. Don't ask for approval at every file edit.

- Inspect the active checkout, existing changes and approved decisions first.
- Make the smallest complete change, including the tests and docs it needs. Don't add unrelated tooling, CI, publication workflows or cleanup.
- Keep changes easy to review. A broader plan discussed earlier doesn't authorize extra work now.

## Protect existing work

- Preserve unrelated edits, user files and useful comments, TODOs, review history and documentation.
- Update the owning docs when behavior changes. Don't leave stale instructions or delete useful context as incidental cleanup.
- Change the authoritative source and regenerate outputs; don't hand-edit generated files.
- Keep credentials, private files and unauthorized third-party artwork out of the repository.
- Remove temporary scripts and debug output created for the task unless they're intentional project files.

## Know when to ask

Get explicit approval before major architecture changes, unrelated features, destructive changes to user-owned data, or changes to protected artwork and rights decisions that weren't part of the request.

Ordinary module organization and other local implementation choices don't need separate approval when they stay within the requested work and existing rules. If existing behavior conflicts with an approved design or rights decision, surface the conflict instead of guessing.

## Git safety

The user controls staging, commits and pushes. Never stage, commit, push or rewrite history without separate permission for that operation. Follow `git-safety.md` for worktrees and other Git operations.
