# Working in this repository

Before implementing spend management, read `docs/technical/build-spend-management.mdx`.
Start with the selected stage in `docs/stages/`; stage 1 is the default target.
Each stage includes frontend, backend, integration, and verification. Stop after
that stage. `docs/technical/stage-boundaries.mdx` allocates shared contracts and
reference sections so later behavior does not expand the task. No prior
conversation or external working notes are required.

Before changing financial schemas or service interfaces, read
`docs/technical/contracts.mdx`, `docs/technical/database-schema.mdx`, and
`docs/technical/rpc.mdx`, using the selected stage projections. For processing, calculations, or AI behavior, read the
corresponding protocol linked from `docs/technical/index.mdx`.

When implementing imports, reconciliation, or financial-data validation, inspect the
actual CommBank source files in `fixtures/commbank/`. This directory is Git-ignored
and local only. Read the "Actual CommBank files" section in
`docs/technical/ingestion.mdx` for context.

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
