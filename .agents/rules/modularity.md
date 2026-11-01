# Modularity

## Keep modules focused

Each module should have a clear job. Before adding code, check whether it belongs there or whether an existing module already handles it.

## Know when to split

Split a module when:

- It handles unrelated jobs or keeps changing for unrelated reasons.
- Parts of it have different dependencies, contracts or testing needs.
- A focused part can be reused or tested on its own.

Don't split just because a file is long. A large file doing one job is better than several tiny files with no clear purpose.

## Keep related code together

- Don't create one-function wrappers, empty packages or generic abstractions without a real need.
- Keep types close to the code that owns them. Share types only when multiple modules actually use the same contract.
- Follow the repo's existing Bun and TypeScript patterns instead of inventing a new layout.

## Reuse existing boundaries

- Check nearby modules before adding new logic. Reuse the existing parser, validator, renderer or rights checks rather than creating a second version. See `reuse.md`.
- Orchestrators can coordinate several modules, but shouldn't contain all the logic they're coordinating.
- Add a clear public entrypoint when other packages or consumers need one. Don't add barrel files or package exports just for consistency.

## Before finishing

Check that the change hasn't added unrelated work to a module, duplicated existing behavior or introduced unnecessary layers. When moving code, preserve the generated artwork, visual output, metadata and build behavior.

Don't refactor unrelated code just to make the structure look cleaner.
