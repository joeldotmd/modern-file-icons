# Testing

Use the existing Bun tests in `tools/*.test.ts`. Test the behavior that matters at the module responsible for it, not the shape of the implementation.

## Test behavior, not implementation

Cover real contracts, regressions and important edge cases. Test valid inputs and expected rejections, especially for SVG safety, rights and release gates. Don't write tests that only repeat the code or check trivial runtime behavior.

For a bug fix, reproduce the failure, add a regression test at the responsible module, fix it and verify the corrected behavior.

## When to add tests

Check `tools/*.test.ts` before writing new tests. Add a test when current tests would miss a real bug. Focus on SVG safety, filesystem changes, rights checks, release gates, and tricky failure cases.

Don't add a test for every helper or icon. Usually skip new tests for documentation or cosmetic edits, trivial wrappers, config changes with no behavior change, and refactors already covered by tests. Still run the required visual, safety, rights, and release checks when a change affects them.

Prefer adding cases to an existing test file. Avoid duplicate checks, low-value variations, and tests added just to raise coverage.

**Before creating a new test file, explain what behavior or regression it protects and why no existing test file can cover it.** If you can't explain both, extend an existing file or don't add the test.

Don't weaken useful tests or skip required checks to reduce test count.

## Choose the right test level

| Level | What to test |
| --- | --- |
| Unit | SVG validation, normalization, parsing, colors, mappings and fallbacks. |
| Integration | Schema and metadata consistency, generated catalogs, filesystem safety, rights decisions and release eligibility. |
| Visual | Geometry, colors, light/dark variants, calibration, bleed and folder states at relevant sizes. |
| Release | The actual generated package, required notices and exclusion of held artwork. |

Use the lowest level that proves the contract. Keep thorough tests near the owner; consumers only need enough coverage to prove their integration works.

## Fixtures and visual testing

- Keep fixtures small and deterministic. Don't depend on private files, live services, real-time delays or unpredictable randomness.
- Use real temporary directories for path, symlink, file placement and publication-safety tests. Clean up after the test, and never run destructive tests on user-owned files.
- Test both approved and rejected cases for safety gates. Today's approval count alone doesn't prove a gate works.
- Preserve strict pixel comparisons for reviewed artwork. Any visual baselines and fixtures needed for automated comparisons must live in this repository. If that coverage doesn't exist yet, report the gap instead of claiming a visual match.
- Account for browser anti-aliasing or positioning differences explicitly. Don't relax thresholds just to make a mismatch pass.

## Before finishing

Check that the important edge cases are covered without duplicating whole test suites. Test count and coverage percentage don't replace meaningful assertions.

`verification.md` lists the checks to run and the evidence to report. Unit tests don't replace release checks, and visual tests don't establish legal permission.
