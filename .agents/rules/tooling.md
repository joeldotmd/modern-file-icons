# Tooling

## Runtime and package management

Use the Bun version pinned by `packageManager` in `package.json` for installs, scripts, TypeScript execution and tests. Let Bun manage `bun.lock`; don't edit it by hand or introduce another package manager or lockfile.

Use the existing toolchain rather than adding a second TypeScript runner, test runner or package manager without a real need.

## Development tools

- Use Prettier for formatting, strict TypeScript for type checks and Ajv for schema validation.
- Use the existing `@xmldom/xmldom` SVG parser, `@resvg/resvg-js` renderer and Playwright/Chromium browser tooling where appropriate.
- Use `@vscode/vsce` to package the VS Code extension; don't hand-assemble VSIX archives.
- Keep artwork and rights requirements separate from general tooling. See `artwork-and-themes.md` and `rights-and-release.md`.

## Commands

| Task | Command |
| --- | --- |
| Install dependencies | `bun install` |
| Run local checks | `bun run check` |
| Format / check formatting | `bun run format` / `bun run format:check` |
| Typecheck | `bun run typecheck` |
| Test | `bun run test` |
| Generate / check schema types | `bun run schema:generate` / `bun run schema:check` |
| Validate artwork | `bun run icons:validate` |
| Generate / check the icon catalog | `bun run icons:generate` / `bun run icons:check` |
| Validate / build the theme | `bun run theme:validate` / `bun run theme:build` |
| Check rights / public release | `bun run rights:check` / `bun run public:check` |
| Pack / check the release package | `bun run theme:package` / `bun run theme:package:check <tarball>` |
| Pack the VS Code extension (after `theme:package`) | `bun run vscode:package` |

Check whether a command writes files before running it. Formatting, generation and theme builds modify outputs. `bun run check` also runs a public-safe build, so it isn't entirely read-only.

`theme:package` rebuilds the theme, packs the release profile as `dist/modern-file-icons/package/<theme id>-<version>.tgz` with a `.sha256` file, and checks the packed tarball. It normalizes file modes, so the same sources pack to the same bytes on any machine. `vscode:package` builds a VSIX from that tarball for local checks only: its publisher is a placeholder, and vsce timestamps its generated entries, so rebuilds match in content but not in bytes. Publishing to npm, the VS Code Marketplace or Open VSX isn't set up.

## Dependencies and portability

Reuse the current schemas, libraries and SVG tools before adding dependencies. Add a tool when it clearly improves correctness or maintainability, not just to reduce or increase the package count.

Bun is this repository's development runtime; generated themes and public data should remain usable by other applications without requiring Bun. Artwork from upstream libraries still has its own licensing terms.

## Before finishing

Run the smallest relevant check, then broader checks when shared contracts or generated output change. Inspect generated artifacts when applicable and report checks you couldn't run; see `verification.md`.

There is no approved automated publishing or CI workflow here. Don't add one as part of an unrelated task.
