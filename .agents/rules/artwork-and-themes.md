# Artwork and Themes

## Sources of truth

The SVGs and their sibling JSON files in `icons/` are the source of truth for artwork and its provenance. The library must be usable, buildable and testable from files in this repository.

Themes decide which artwork to use and how to display it. The Modern File Icons theme's choices live in `themes/modern-file-icons/selections.json`, with positioning in `folder-calibration.json` and rights decisions in `rights.json`. Each future theme can have its own choices without changing shared SVGs.

`schemas/` defines metadata contracts. `tools/icons.ts` generates `icons.json`; `tools/schema.ts` generates TypeScript declarations. The theme's `theme.json` and `associations.json` are generated files. Change authoritative artwork or theme data, then regenerate outputs rather than editing generated files directly.

## Visual changes

- Preserve the user's approved primary and alternatives. Do not change their geometry, colors, stroke, calibration or folder closed/open states as incidental cleanup.
- Preserve the theme's rendering behavior, including stroke treatment, recoloring, calibration and inherited color. Check how the icon actually renders, not just its stored settings.
- Respect `light` variants, nested SVG viewports, optically adjusted composites, overflow/bleed and `modernFileIcons.fixedSizes`. The release manifest records how a host must draw them.
- Use the exact approved source and provenance. Imported SVGs carry `origin.sha256`; a changed hash means the artwork no longer matches its imported source.
- A new candidate, a reviewed alternative and an approved primary are different states. Never silently promote a candidate or replace an approved SVG because another library has a similar icon.
- Keep Simple Icons brand artwork standalone. Folder/file composites using those brand marks are not approved merely because the Simple Icons project is CC0. See `rights-and-release.md`.

Composites may need optical adjustments rather than simply stacking SVGs. Review their actual appearance before approving changes.

## Changes and verification

1. Check the canonical SVG, its metadata and any themes using it before making a change.
2. Get approval before replacing selected artwork or changing an approved design.
3. Update the source artwork or theme records and regenerate the affected outputs.
4. Check the built artwork at 18/24/96 px, in light/dark mode and both folder states where applicable. Confirm the appearance and layout are still correct.

Run the repository's self-contained checks:

```sh
bun run check
bun run theme:build
```

`theme:build` writes output under `dist/modern-file-icons/`. It does not, by itself, prove that a visual change was approved or matches a stored visual baseline. Future automated visual regression checks must use sources and fixtures that ship with the repository, not an external review tool.

Reuse the existing artwork and rendering tools rather than writing a second implementation. See `verification.md` for required checks and `testing.md` for test design.
