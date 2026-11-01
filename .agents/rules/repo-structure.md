# Repository Structure

## Current layout

| Path | What belongs here |
| --- | --- |
| `icons/folders/`, `icons/files/`, `icons/symbols/` | Canonical SVGs and their sibling JSON metadata. |
| `themes/modern-file-icons/` | Approved selections, calibration and rights decisions; generated `theme.json` and `associations.json`. |
| `schemas/` | JSON Schemas for artwork, themes, associations, rights and the release manifest. |
| `tools/` | SVG checks, imports, normalization, theme builds, rights checks, catalog generation and verification. |
| `icons.json` | Generated artwork catalog, maintained by `tools/icons.ts`. |
| `tools/*generated.ts` | Types generated from the schemas by `tools/schema.ts`. |
| `licenses/`, `THIRD-PARTY-NOTICES.md` | Third-party license texts and required notices. |
| `dist/modern-file-icons/` | Generated preview, release and verification output, the release tarball (`package/`) and a local VSIX (`vscode/`); not committed. |
| `held/icons/` | Created when artwork lacks release approval. Never publish it or its Git history. |

## Where new files belong

- Put finished SVGs and source metadata in `icons/`, not copies inside individual themes.
- Keep theme selections, colors, positioning, mappings and rights decisions with the theme they belong to. Other themes can have their own directories under `themes/`.
- Keep shared schemas in `schemas/` and build, import, validation and export logic in focused modules under `tools/`.
- Change source records or generators, then rebuild. Don't edit `icons.json`, generated TypeScript, theme manifests or `dist/` by hand.
- The public catalog includes only `icons/`. Keep artwork without release approval out of distributable output; see `rights-and-release.md`.

## When to add directories or packages

Use existing locations first. Add a directory, package or workspace only when it has a real responsibility, separate requirements or actual consumers. Don't add structure just because a possible future feature has a name.

## When moving things

- Check imports, paths, schemas, scripts, tests, generated outputs and documentation. Update anything that refers to the old location.
- For artwork, also check variants, theme selections, mappings, source hashes, license notices and release approval before moving or renaming it.
- Run the relevant checks and inspect the generated release output. Don't lose metadata, change approved visuals or accidentally include held artwork.

See `architecture.md` for boundaries and `instruction-maintenance.md` for keeping instructions current.
