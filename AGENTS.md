# Working in this repository

Before implementing spend management, read `docs/product/index.mdx` for scope and
`docs/technical/index.mdx` for the design. Follow their links to the affected
feature. Product pages define intended behavior. Technical pages define the
target architecture. Planned paths are not yet implemented.

Before changing test layout or setup, read `docs/technical/verification.mdx`.

`docs/` is a Blume site. Run `pnpm docs:dev` to browse it locally and
`pnpm docs:build` after changing pages or documentation configuration.

Infrastructure belongs in `infra/`; Worker bindings are defined once in
`infra/src/worker-bindings.ts` and imported by each runtime.

Run `pnpm check`, `pnpm typecheck`, and `pnpm test` before committing.

`.repos/` contains read-only source references. When writing Effect code, read
`.repos/effect/LLMS.md` and inspect the matching version there before choosing
an API or project idiom.
