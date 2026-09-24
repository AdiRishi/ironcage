# Working in this repository

Ironcage is a private finance application that explains one person's money. Read
`docs/vision.mdx` for the intent and `docs/roadmap.mdx` for what is being built
now.

Before changing a domain, read its reference page in `docs/reference/`. Update
that page in the same commit as the code; reference pages describe the code as
it is.

- Financial schemas or the write protocol: `ledger.mdx`.
- Descriptors, counterparties, roles, categories, provenance: `interpretation.mdx`.
- Measures, the flow, ledger facts: `analysis.mdx`.
- Model calls and enrichment: `ai.mdx`.
- Test layout: `verification.mdx`.
- A new workspace or infrastructure: `architecture.mdx`. Infrastructure belongs in
  service-owned modules under `infra/`, composed by `infra/src/worker-bindings.ts`.

Screens follow `docs/product/` for behavior and `docs/design/index.mdx` for the
visual language. `docs/glossary.mdx` fixes the vocabulary.

Keep exact money, date, descriptor, and measure rules in `packages/finance`,
imported by every consumer. Use installed libraries and Cloudflare platform
features before writing custom code, and check the installed source and official
documentation before choosing an API.

`fixtures/commbank/` holds the real CommBank corpus and is git-ignored. Inspect it
when working on imports, descriptors, or enrichment. Report only aggregate counts
from it; its rows never go into tracked files, snapshots, or logs.

The local stack (`pnpm dev`) and its Docker database are disposable. Destroy,
recreate, and reimport the corpus freely.

`docs/` is a Blume site. Run `pnpm docs:build` after changing pages or
`blume.config.ts`.

Run `pnpm check`, `pnpm typecheck`, and `pnpm test` before committing.

`.repos/` holds read-only source references. When writing Effect code, read
`.repos/effect/LLMS.md` and the matching version there before choosing an API or
idiom.
