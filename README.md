# Ironcage

Ironcage is a private personal finance application for one user. It is built in seven stages, starting with uploading CommBank exports and recording every posting once. Each stage delivers a working frontend and backend before the next adds more.

Stages 1 and 2 implement CSV, OFX, and PDF imports, cross-format matching, source
review, transaction history, exports, and original-file removal. The API owns
Postgres writes, the processor runs Cloudflare Workflows, and the TanStack Start
frontend uses shadcn/ui. Exact money, dates, and matching rules live in shared
packages.

The [stage 1](docs/stages/record-transactions.mdx) and
[stage 2](docs/stages/historical-imports.mdx) pages record verification evidence.
Local corpus verification and a managed PlanetScale restore have passed. Hosted
verification is pending a Cloudflare credential with Access Apps and Policies
Edit permission. Private data has only been imported locally.

## Run the application

Use Node 24, pnpm, and a running Docker engine. Install dependencies with
`pnpm install`, then run `pnpm dev`. Alchemy creates persistent local Postgres
storage, applies migrations, and starts the Workers and web app. Open the
`websiteUrl` printed by the stack.

Hosted configuration is documented in [Operations](docs/technical/operations.mdx)
and `infra/.env.example`. Alchemy profiles hold provider credentials. Complete
the Access and backup checks before importing private data into a hosted stage.
The private corpus stays in the ignored `fixtures/commbank/` directory; CI uses
synthetic fixtures.

## Read the docs

The [published documentation](https://adirishi.github.io/ironcage/) is built with [Blume](https://useblume.dev/). To run it locally:

```sh
pnpm docs:dev
```

- [Delivery stages](docs/stages/index.mdx)
- [Product](docs/product/index.mdx)
- [Technical](docs/technical/index.mdx)
- [Glossary](docs/glossary.mdx)
- [Vision](docs/vision.mdx)

Edit pages in `docs/`. Run `pnpm docs:doctor` to check content and `pnpm docs:build` to generate the static site in `dist/`. Pushes to `main` publish the site through GitHub Pages.

## Common commands

| Command                | Purpose                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `pnpm dev`             | Run the local application through Alchemy                          |
| `pnpm check`           | Lint code and check formatting                                     |
| `pnpm typecheck`       | Check production and test TypeScript projects                      |
| `pnpm test`            | Run all local tests, including infrastructure                      |
| `pnpm test:unit`       | Run tests without infrastructure, as CI does                       |
| `pnpm test:infra-live` | Deploy, test, and destroy an isolated Cloudflare stage             |
| `pnpm plan`            | Preview production infrastructure changes                          |
| `pnpm prod`            | Deploy the production stage                                        |
| `pnpm sync:repos`      | Match source references in `.repos/` to pinned dependency versions |
