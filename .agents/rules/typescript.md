# TypeScript

## Keep TypeScript strict

Use the existing strict `tsconfig.json`. Don't weaken compiler settings, add `any` or suppress errors just to make a change pass.

## Use existing contracts

- JSON Schemas in `schemas/` define the artwork, rights, associations, theme and release manifest contracts. Use their generated TypeScript types rather than maintaining competing definitions.
- Change the owning schema first when a contract changes, then run `bun run schema:generate`. Never hand-edit `tools/*generated.ts`.
- Keep local types near the code that owns them. Share a type when multiple modules actually depend on the same contract, not for hypothetical reuse.

## Validate external data

Treat SVGs, imported JSON, icon metadata, theme manifests, package definitions and CLI inputs as untrusted. Parse and validate them before using them as typed domain values.

Prefer `unknown` at these boundaries, then narrow with the existing validators and Ajv schemas. A TypeScript assertion isn't runtime validation.

## Write clear, safe types

- Use inference for straightforward local values. Add explicit types for contracts, important state and boundaries where they improve clarity.
- Avoid unchecked casts and chained assertions used to silence errors. If an assertion is unavoidable, make its safety clear and keep it at the boundary.
- Model meaningful states so invalid combinations are hard to express. Handle known variants and decision states exhaustively where practical.
- Keep public data formats and reusable logic portable; don't make consumers depend on Bun-specific APIs unnecessarily.
- Don't add speculative types, type helpers or schema libraries without a real need.

## Before finishing

Run `bun run schema:check` and `bun run typecheck` for schema or TypeScript changes. Use broader checks from `verification.md` when shared contracts, artwork or generated outputs are affected.
