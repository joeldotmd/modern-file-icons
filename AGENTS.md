# Modern File Icons Development Guide

Modern File Icons is a standalone SVG icon library and theme builder. It owns the artwork, provenance, theme definitions and tools needed to validate and export icon themes. Its first theme is also called Modern File Icons. Keep shared artwork and exports independent of any consuming app.

## Before changing anything

1. Read the rules in `.agents/rules/` that apply to the task.
2. Check the active checkout, Git state and existing work before editing.
3. Find the owning artwork, metadata, theme record or schema. Check design and rights approvals before changing protected decisions.
4. Follow existing code and tests. If records, documentation and implementation disagree, flag the conflict rather than guessing.

Use instructions from this checkout, not another repository or worktree. Don't rely on private files or external review tools for normal builds and checks.

## Repository map

| Path | Responsibility |
| --- | --- |
| `icons/{folders,files,symbols}/` | Canonical SVGs with sibling JSON metadata and provenance. |
| `themes/modern-file-icons/` | Selected artwork, calibration, rights records and theme definitions. |
| `schemas/` | Artwork, rights and theme contracts. |
| `tools/` | Import, validation, generation, rendering and release checks. |
| `icons.json` | Generated icon catalog. |
| `licenses/`, `THIRD-PARTY-NOTICES.md` | License texts and required notices. |
| `dist/modern-file-icons/` | Generated preview, release, reports, release tarball (`package/`) and local VSIX (`vscode/`); not committed. |
| `held/icons/` | Restricted artwork, when present; never publish it. |

`themes/modern-file-icons/selections.json`, `folder-calibration.json` and `rights.json` are the corresponding sources of truth. `theme.json` and `associations.json` are generated. Edit the owning source or generator, not generated catalogs, manifests, notices or TypeScript declarations.

## Keep these constraints

- Preserve approved SVG geometry, colors, strokes, calibration, light/dark variants and folder states. Don't change reviewed artwork without approval.
- Preserve source provenance and hashes. Don't hand-edit imported SVGs as incidental cleanup.
- Check third-party copyright, licenses, trademarks and allowed uses separately. Internal approval and passing checks do not grant someone else's rights.
- Keep restricted artwork out of public source and release packages. Preserve required license text, attribution and restrictions.
- Keep Simple Icons brand marks standalone; don't turn them into folder or file composites based only on the source library's license.
- Prefer existing tools and contracts. Keep the library portable, without adding app-specific or speculative dependencies.
- Preserve unrelated work. Don't stage, commit, push or rewrite Git history without explicit authorization.

## Verification

Run focused checks first; use `bun run check` for broad changes. For theme output, run `bun run theme:build` and inspect the generated files. For rights and releases, run `bun run rights:check` and `bun run public:check`.

The build alone doesn't prove pixel-perfect visual fidelity or legal permission. Use repository-owned visual baselines when available and report missing verification. `verification.md` has the change-specific checks; `testing.md` covers test design.

## Find the right rule

All paths below are relative to `.agents/rules/`.

| Concern | Rules |
| --- | --- |
| Architecture and file ownership | `architecture.md`, `repo-structure.md` |
| Artwork, themes and rights | `artwork-and-themes.md`, `rights-and-release.md` |
| Scope and Git safety | `change-discipline.md`, `git-safety.md` |
| Code quality and reuse | `quality.md`, `modularity.md`, `reuse.md` |
| Tools and types | `tooling.md`, `typescript.md` |
| Tests and checks | `testing.md`, `verification.md` |
| Instructions and writing | `instruction-scope.md`, `instruction-maintenance.md`, `writing-style.md` |

## Before finishing

Report what changed, which checks actually ran, what remains unverified and any follow-ups. Keep the documentation accurate without exposing unnecessary internal research or approval history.
