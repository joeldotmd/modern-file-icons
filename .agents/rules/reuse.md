# Reuse

## Check what exists first

Before writing new code or adding artwork:

1. Check existing artwork, code, schemas and tools in this repository.
2. Check whether an installed dependency already handles it.
3. Check what Bun and the runtime provide.
4. Look at established external libraries or SVG tools if there's still a gap.
5. Add only the code or dependency the task actually needs.

## Reuse the right owner

Keep one implementation of shared behavior, such as SVG processing, theme mappings, validation and provenance, instead of duplicating it for each export format.

Reuse code when it has the same purpose and rules. Don't force unrelated behavior together just because it looks similar, and don't build a generic abstraction for a hypothetical future consumer. See `modularity.md`.

## Check artwork rights

Before using artwork from another library, check its license, source, attribution, trademark restrictions and whether modifications or redistribution are allowed. Availability in a package is not permission for every use. See `rights-and-release.md`.

## Before finishing

Check whether the change duplicates existing logic, introduces a competing dependency or adds an abstraction that isn't needed. Prefer extending the existing owner when it fits.
