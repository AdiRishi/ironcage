# Working in this repository

Read `docs/stages/starting-point.mdx` first. It says what the repository
contains today and what stage 1 deletes and adds.

Then read the selected stage page in `docs/stages/`. Stage 1 is the default. The
stage page owns its milestones, screens, tables, operations, worked examples, and
verification checklist. Its "Also read" section names the reference pages under
`docs/technical/` it depends on. Build the milestones in order, commit at each
one, and stop after the stage. `docs/glossary.mdx` fixes the vocabulary.

Use installed libraries and Cloudflare platform features before writing custom
code. Check the installed source and official documentation before choosing an
API. Keep exact money and date rules in shared code that every consumer imports.

When implementing imports or matching, inspect the real CommBank files in
`fixtures/commbank/`. That directory is git-ignored. Never copy its rows into
tracked files, snapshots, or logs.

Before changing financial schemas or the write protocol, read
`docs/technical/financial-model.mdx`. Before changing test layout, read
`docs/technical/verification.mdx`. Before adding a workspace or changing
infrastructure, read `docs/technical/architecture.mdx`; infrastructure belongs in
service-owned modules under `infra/`, composed by `infra/src/worker-bindings.ts`.

`docs/` is a Blume site. Run `pnpm docs:dev` to browse it and `pnpm docs:build`
after changing pages or `blume.config.ts`.

Run `pnpm check`, `pnpm typecheck`, and `pnpm test` before committing.

`.repos/` holds read-only source references. When writing Effect code, read
`.repos/effect/LLMS.md` and the matching version there before choosing an API or
idiom.
