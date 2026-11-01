# Instruction Maintenance

## Keep instructions accurate

Docs and rules should describe how the repo actually works. Separate what's implemented, what's been approved for later, and what's still just an idea. Don't describe a plan as working code.

## When to update docs

Check the relevant rules and public docs when a change affects:

- Files, directories, module responsibilities or architecture.
- Dependencies, schemas, generated files, scripts or verification commands.
- Artwork sources, theme decisions, rights rules, exports or host integration.
- Agent instructions, development workflows or how rules are loaded.

## Update code and docs together

- Update the owning document in the same task as the code change. If fixing it is outside the task's scope, point out the stale guidance before finishing.
- Keep each rule or decision in one authoritative place and link to it elsewhere. Update the `AGENTS.md` rule list when rules change.
- Follow `writing-style.md` for human-written docs and comments. Keep useful technical reasoning; don't rewrite legal notices or generated files just to change their tone.
- Keep agent instructions versioned with the code, while maintaining separate public README and licensing documentation for users.
- Add a new rule only when a real responsibility needs one.

## Before finishing

Check whether the work made any documented path, command, contract, responsibility or workflow inaccurate. Fix the affected docs, or report what remains outdated.
