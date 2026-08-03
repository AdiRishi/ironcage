# Vendored Repositories

This project vendors external repositories under `.repos/` as read-only reference material for coding
agents.

- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `.repos/` unless explicitly asked.
- Do not import from `.repos/`; application code must continue importing from normal package dependencies.
- Manage vendored subtrees with `pnpm sync:repos`; use `pnpm sync:repos --repo <id>` to sync one
  configured repository.
- When updating a dependency with a configured vendored subtree, sync that subtree in the same change so
  `.repos/` matches the installed dependency version.

## effect

Ironcage is Effect end to end, on a version of Effect that is still in beta and still moving. Read
`.repos/effect/LLMS.md` before writing Effect code, and reach for `.repos/effect/packages/` when you
need the real shape of an API — the vendored tree is pinned to exactly the version this workspace
installs, so it is the only Effect reference here that cannot be out of date.

Two areas where guessing is especially expensive:

- **`BigDecimal`.** Every monetary and quantity value in this system is a `BigDecimal`; a float
  touching money is a bug by definition (`docs/technical/02-domain-model.md`). Check the real
  rounding and division signatures rather than assuming them.
- **`Schema`.** Every boundary decodes through `effect/Schema`. Compiler APIs (`decodeUnknownSync`
  and friends) belong at module scope, not inside a tick — `app/no-inline-schema-compile` will tell
  you when you have got that wrong.
