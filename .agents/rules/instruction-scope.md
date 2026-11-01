# Instruction Scope

## Use this checkout's instructions

Use `AGENTS.md` and the relevant files in `.agents/rules/` from the checkout you're working in. Keep one shared set of instructions rather than maintaining tool-specific copies.

Check the actual repository root, branch, HEAD and working changes. Another worktree may have different code, instructions or approvals.

## Apply the right rules

Start with the user's current request and approvals. Follow the root guide and every rule that applies to the work, then use the relevant schemas, docs, approved design and rights records, code and tests to check the details.

Rules apply to what the change does, not just which file it touches. For example, changing an SVG may involve artwork, rights and verification rules; changing a build tool may involve modularity, testing and generated-file rules.

If sources disagree, point out the mismatch and check the authority for that decision before changing protected artwork, rights or behavior. Historical notes can explain a decision, but don't override the current approved record.

## Keep instructions local

These instructions apply to Modern File Icons, not other repositories or apps. Don't copy instructions from another project or define what that project is responsible for.

Don't make the library depend on private files or review tools outside this repository. Required artwork, theme records and verification inputs should be available in the checkout. Flag existing gaps instead of relying on private material.

Don't treat archives, vendored code, generated output, backups or unrelated worktrees as instruction sources. Generated files are outputs, not sources of truth for decisions.

## Nested instructions

Add a local `AGENTS.md` only when a directory really needs its own guidance. It adds to the root rules without copying them or overriding safety, rights or Git constraints.
