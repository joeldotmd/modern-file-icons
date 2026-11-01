# Writing Style

Write like a senior engineer talking to another engineer: casual, direct and precise. Keep the useful detail; skip the ceremony.

## Voice and tone

- Use plain language, active verbs and short sentences. Split separate decisions into separate paragraphs.
- Name the command, path, SVG, schema or failed check when it matters.
- Explain trade-offs plainly. Don't present preferences, guesses or plans as requirements or facts.
- Skip filler, repeated conclusions, corporate jargon and unproven claims like "robust" or "production-ready". Use headings and lists only when they help.
- Keep exact technical and legal terms where accuracy requires them.

Prefer "Run `bun run rights:check` after changing the register" over "It is recommended that the appropriate rights validation process be executed."

Prefer "The build writes to `dist/`" over "The build process results in the generation of output artifacts within the designated distribution directory."

## Facts, decisions and sources

- Distinguish **what exists now**, **what's approved but not built** and **historical decisions**.
- Keep technical names and verification results exact. Say what was checked, what wasn't and what remains uncertain.
- Don't call third-party artwork legally cleared based only on a library license or internal approval. Copyright, trademarks and permitted uses are separate.
- Link to the authoritative source instead of repeating large sections. Keep history when it still explains a decision; don't present it as current behavior.

## Documentation

- **`AGENTS.md`:** state the repository contract and point to focused rules, not a project chronology.
- **`.agents/rules/`:** one concern per rule, with direct instructions and reasons for non-obvious constraints.
- **`README.md`:** explain what users can do today and how to do it. Don't expose private research, internal approval discussions or unsupported workflows.
- **Licenses and notices:** preserve required license text, copyright statements, trademark conditions, restrictions and attribution exactly. Don't simplify away legal obligations.
- **Generated files:** update the owning source, schema or generator instead of editing generated output.

Use examples when they make a contract clearer. Check referenced commands, paths and links against the repository.

## Code comments

- Explain *why* something unusual is necessary, especially rendering quirks, security constraints and workarounds. Don't narrate obvious code.
- Keep useful comments, JSDoc, TODOs and provenance accurate as code changes. Add JSDoc for non-obvious contracts, not obvious parameters.
- Make errors actionable: say what failed and identify the relevant path, decision or expected value.
- Don't rename symbols or reformat unrelated files merely to enforce writing style.

## Before finishing

Check that claims match the current code or approved direction, references are accurate and the right source was updated. Remove unnecessary prose without losing important technical detail, history or legal terms.
