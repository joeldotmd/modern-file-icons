# Modern File Icons

A curated file and folder icon theme for editors and developer tools. It combines credited artwork from open icon libraries and brand owners with original compositions, and builds a VS Code-compatible theme from it.

## What it includes

- **838 canonical SVGs**: 428 folders, 387 symbols and 23 files, each with sibling JSON metadata for provenance, licensing and changes.
- **867 theme decisions**: 595 file types and 272 folder names, with reviewed colors, strokes and folder states.
- A VS Code-compatible icon theme manifest, plus rendering details for bleed and fixed-size artwork.
- Light/dark variants, rights-aware release builds and per-file licence notices.

Themes select artwork; they don't change canonical SVGs. One SVG can be used by more than one theme.

## Get started

Install [Bun](https://bun.sh), then run:

```sh
bun install
bun run check
bun run theme:build
```

The distributable files are written to `dist/modern-file-icons/release/`. Use that directory rather than the local-only `preview/` build. The release contains the manifest, SVGs, `NOTICE.md`, `LICENSE`, `THIRD-PARTY-NOTICES.md` and the required licence texts.

## Releases

Releases are published on GitHub Releases as `modern-file-icons-<version>.tgz`, with a `.sha256` file. Check the tarball against its SHA-256 before using it. A published version is never replaced; fixes ship as a new version.

The tarball unpacks to `package/`, containing `package.json`, `manifest.json`, `icons/`, `LICENSE`, `NOTICE.md`, `THIRD-PARTY-NOTICES.md` and `licenses/`. Package managers that accept tarball URLs can install it directly; the manifest is then importable as `modern-file-icons/manifest.json` and the SVGs as `modern-file-icons/icons/<name>.svg`.

## Use the theme in a host

`manifest.json` uses the VS Code icon-theme mappings: `iconDefinitions`, default `file`/`folder`/`rootFolder` icons, expanded folders and filename, extension, language and folder-name associations.

The host must also handle four details of this theme:

1. **Bleed:** `modernFileIcons.bleed` pads each SVG by one-third of the icon size per side. Draw the image at `size × (1 + 2 × bleed)` and apply a negative margin of `size × bleed`. For 18 px icons, render 30 px with a −6 px margin; for 24 px, render 40 px with a −8 px margin.
2. **Fixed sizes:** `modernFileIcons.fixedSizes` currently specifies `stencil: 24`. Draw that artwork at its recorded size, including bleed, from the top-left of the requested icon box.
3. **Light mode:** Use the manifest's `light` overrides for artwork or colors that change with the theme.
4. **Unmatched names:** Use the manifest's default `file` or `folder` artwork.

The release SVGs already carry their resolved colors. Hosts load them as images rather than trying to recolor them.

## Repository layout

| Path                        | Purpose                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `icons/`                    | Canonical artwork and sibling JSON metadata                                     |
| `icons.json`                | Generated artwork catalog                                                       |
| `themes/modern-file-icons/` | Visual selections, calibration, theme, name associations and rights register    |
| `schemas/`                  | JSON Schemas for artwork, themes, associations, rights and the release manifest |
| `tools/`                    | Importer, validators, build tools and tests                                     |
| `licenses/`                 | Upstream licence texts and owner artwork notices                                |
| `THIRD-PARTY-NOTICES.md`    | Licence exceptions and required credits                                         |

`dist/` is generated. Maintainers import and visually check the theme against a private review selector, which is not part of this repository. Building, packaging and the rights checks need only the files here.

## Checks and verification

`bun run check` runs formatting, schema/type checks, tests, catalog and theme validation, rights validation and a public-safe build.

For repository work, start with [`AGENTS.md`](AGENTS.md) and the relevant [engineering rules](.agents/rules/). Those instructions are versioned with the code; they do not replace the public documentation or the artwork's licence terms.

For changes to artwork, the importer or the theme, maintainers also run:

| Command                                             | Purpose                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `bun run theme:import -- --selector <html>`         | Import the approved selection and calibration from the private selector     |
| `bun run theme:reproduce -- --selector <html>`      | Check that a fresh import matches byte for byte                             |
| `bun run theme:build -- --selector <html>`          | Compare the built SVGs against the selector using resvg at 18, 24 and 96 px |
| `bun run theme:verify-browser -- --selector <html>` | Compare the release rendering against the original selector in Chromium     |

The build reports are saved under `dist/modern-file-icons/`. Visual comparisons cover light/dark modes and relevant closed/open folder states. A passing build does not establish copyright or trademark permission.

## Icon sources and licences

Artwork comes from Lucide, Hugeicons Free, Phosphor, Solar, Material Icon Theme, Material Design Icons, Google Material Icons, Simple Icons and individual project owners. Each icon's JSON metadata records its actual source, licence and modifications.

The project code and original artwork use [MIT](LICENSE). **Third-party artwork keeps its own terms**, including CC BY, ShareAlike and NoDerivatives exceptions. See [third-party notices](THIRD-PARTY-NOTICES.md) and the files in [`licenses/`](licenses/).

Brand marks are used to identify relevant file types. They do not imply endorsement or affiliation. The [rights register](themes/modern-file-icons/rights.json) records distribution approvals, usage limits and unresolved conditions; it is not a grant of rights from the trademark owners. If you own a mark and have a concern, [open an issue](https://github.com/joeldotmd/modern-file-icons/issues) identifying the icon.

## Contributions

Outside contributions are not open yet. Bug reports and brand requests can be filed through [GitHub issues](https://github.com/joeldotmd/modern-file-icons/issues).
