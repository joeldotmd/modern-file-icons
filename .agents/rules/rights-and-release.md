# Rights and Release

## Check artwork rights

Before using or changing third-party artwork, check copyright, trademarks, permitted modifications, attribution and intended use. The repository's MIT license does not replace an artwork owner's terms. Preserve required licenses and notices.

## Record decisions

Keep rights evidence, conditions and release decisions in the owning theme's rights records, such as `themes/modern-file-icons/rights.json`. Don't treat an internal approval or a successful check as permission from a rights holder. Never expand an approved use or change a rights decision without evidence and explicit authorization.

## Ship only eligible artwork

Keep restricted artwork out of public source and release packages; use a permitted fallback where needed. Check Git history before publishing a previously private repository. Distribute reviewed release output, not local previews.

Keep required credits, license texts, change notices and restrictions in distributed artifacts. Update source records and generators, not generated notices.

## Verify

Run `bun run rights:check` and `bun run public:check`, then inspect what will ship. These checks verify repository consistency and release packaging, **not independent legal clearance**. Building a package does not authorize publishing it.

For artwork changes, also follow `artwork-and-themes.md`; for required checks, follow `verification.md`.
