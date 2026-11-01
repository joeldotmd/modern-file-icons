# Architecture

## What this repo does

Modern File Icons is a standalone icon library. It owns SVG artwork, icon themes and the tools to build and distribute them. Its first theme is also called Modern File Icons; the library can support others.

Editors and other apps can use its exported themes. Keep anything an individual app needs separate from the shared icons and themes.

## Keep responsibilities separate

- **Artwork:** the SVGs, their variants, metadata and source credits. Artwork should work without the tools used to make it.
- **Themes:** which icons to use, their colors, positioning and file/folder mappings. Keep theme choices separate from the SVGs themselves.
- **Tools:** importing, building, validating and checking artwork and themes.
- **Host integrations:** formats and adapters needed by specific apps. We currently export a VS Code-compatible manifest with extra rendering data under `modernFileIcons`; other apps may need their own integration.

## Keep it simple

- Keep one source of truth for each icon, theme decision and shared rule. Generate exports from those sources instead of maintaining copies by hand.
- Don't tie shared icon or theme code to any one app.
- Add packages, adapters or generators when there's a real use for them, not just in case.
- Don't change approved icon designs as part of a tooling change. See `artwork-and-themes.md` for visual rules.
