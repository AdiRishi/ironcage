# Working in this repository

Before implementing spend management, read `docs/technical/build-spend-management.mdx`.
It defines the reading path, decision ownership, and completion requirements.
Use the linked product and technical pages as the project specification. No prior
conversation or external working notes are required.

Before changing test layout or setup, read `docs/technical/verification.mdx`.

`docs/` is a Blume site. Run `pnpm docs:dev` to browse it locally and
`pnpm docs:build` after changing pages or documentation configuration.

Infrastructure belongs in `infra/`; Worker bindings are defined once in
`infra/src/worker-bindings.ts` and imported by each runtime.

Run `pnpm check`, `pnpm typecheck`, and `pnpm test` before committing.

`.repos/` contains read-only source references. When writing Effect code, read
`.repos/effect/LLMS.md` and inspect the matching version there before choosing
an API or project idiom.
