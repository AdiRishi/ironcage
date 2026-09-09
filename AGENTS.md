# Working in this repository

Before implementing spend management, read `docs/technical/build-spend-management.mdx`.
It defines the reading path, decision ownership, and completion requirements.
Use the linked product and technical pages as the project specification. No prior
conversation or external working notes are required.

Before changing financial schemas or service interfaces, read
`docs/technical/contracts.mdx`, `docs/technical/database-schema.mdx`, and
`docs/technical/rpc.mdx`. For processing, calculations, or AI behavior, read the
corresponding protocol linked from `docs/technical/index.mdx`.

Before changing test layout or setup, read `docs/technical/verification.mdx`.

`docs/` is a Blume site. Run `pnpm docs:dev` to browse it locally and
`pnpm docs:build` after changing pages or documentation configuration.

Before adding a workspace, moving shared code, or changing service resources, read
`docs/technical/monorepo.mdx`. Infrastructure belongs in service-owned modules under
`infra/`. The binding module `infra/src/worker-bindings.ts` composes their capabilities.

Run `pnpm check`, `pnpm typecheck`, and `pnpm test` before committing.

`.repos/` contains read-only source references. When writing Effect code, read
`.repos/effect/LLMS.md` and inspect the matching version there before choosing
an API or project idiom.
