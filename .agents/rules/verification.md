# Verification

## Match verification to the change

Run the smallest check that proves the change works, then broaden it when shared contracts, generated artwork or release behavior are affected. Report only checks you actually ran.

## Required checks

| Change | Verification |
| --- | --- |
| Documentation only | Check claims, paths, commands and links; run formatting checks. |
| TypeScript or schemas | `bun run schema:check`, `bun run typecheck` and relevant tests. |
| Artwork or metadata | `bun run icons:check`, relevant tests and `bun run theme:validate`. |
| Theme selection or rendering | `bun run theme:build`; inspect the generated SVGs and use available repository-owned visual comparisons. |
| Rights, notices or release placement | `bun run rights:check`, `bun run public:check`; inspect the release artifacts. |
| Shared contracts or broad changes | `bun run check` plus any relevant rendering checks that the full script does not cover. |

Check what each command writes before running it. `theme:build`, `schema:generate`, `icons:generate` and `theme:import` modify files. `bun run check` includes a public-safe build, so it isn't entirely read-only.

## Verify the actual output

- SVG inputs must pass the repository's safety validation. Check the rendered result, not just the source markup.
- For artwork changes, inspect 18/24/96 px output, light/dark appearance and closed/open folder states where applicable. Preserve calibration, color, bleed and fixed-size behavior; see `artwork-and-themes.md`.
- Strict pixel comparisons require versioned reference fixtures in this repository. If they aren't available, report visual regression coverage as unverified instead of claiming a pixel-perfect match. Browser anti-aliasing and position-only differences need separate reporting, not a blanket pass.
- Check the built release, not just the preview. Held artwork must be absent from public-safe output; licenses, restrictions and notices must be preserved.

## Report evidence and limitations

For substantial changes, report the changed paths, the commands run and their results, any skipped checks and why, and remaining follow-ups. Don't treat an unrun check as passed.

Rights checks confirm repository consistency, **not legal permission**. A successful theme build doesn't prove visual approval or integration with a consuming application. `testing.md` owns test design; this rule defines the evidence needed to finish.

## Before finishing

Inspect the changed files and generated output, preserve existing Git work, and keep command and documentation references accurate. Report anything you could not verify.
