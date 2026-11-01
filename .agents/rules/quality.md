# Quality and Minimalism

## Build the smallest complete solution

Solve the requested problem without unrelated changes or shortcuts. The smallest correct solution isn't always the one with the fewest lines or files.

Don't add speculative features, generators, themes, dependencies, workflows or empty folders. Keep planned work out of the implementation until it's needed.

## Reuse before adding

Check existing artwork, code, types, tools and dependencies before creating something new. Prefer a focused change over a parallel implementation or unnecessary abstraction. See `reuse.md` and `modularity.md`.

## Don't compromise correctness

- Don't remove validation, hide failures behind catch-all error handling or weaken useful error messages just to shorten code.
- Preserve SVG safety, approved visual behavior, metadata, provenance, licensing and release restrictions. See `artwork-and-themes.md` and `rights-and-release.md`.
- Keep the tests and verification needed to prove the change works. See `testing.md` and `verification.md`.
- Keep documentation accurate and direct. See `instruction-maintenance.md` and `writing-style.md`.

## Before finishing

Check whether every new file, helper, dependency and abstraction serves the task. Look for duplicated logic, unnecessary complexity, missing checks or safety rules lost during simplification. Remove what isn't needed without weakening the result.
