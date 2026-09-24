# Ironcage

Ironcage is a private finance application that explains one person's money. It
imports CommBank CSV, OFX, and PDF statements, records every posting once with
its evidence, and interprets it: who each payment went to, what it was for, and
whether it was spending at all. Then it shows where money came from, where it
went, and what changed.

It runs on Cloudflare Workers with Postgres, and is developed locally against the
real corpus. See the [roadmap](docs/roadmap.mdx) for what is built and what is
being built.

## Run the application

Use Node 24, pnpm, and a running Docker engine. Install dependencies with
`pnpm install`, then run `pnpm dev`. Alchemy creates persistent local Postgres
storage, applies migrations, and starts the Workers and web app. Open the
`websiteUrl` printed by the stack.

Hosted configuration is documented in [Operations](docs/reference/operations.mdx)
and `infra/.env.example`. Alchemy profiles hold provider credentials. Complete
the Access and backup checks before importing private data into a hosted stage.
The private corpus stays in the ignored `fixtures/commbank/` directory; CI uses
synthetic fixtures.

## Read the docs

The [published documentation](https://adirishi.github.io/ironcage/) is built with [Blume](https://useblume.dev/). To run it locally:

```sh
pnpm docs:dev
```

- [Vision](docs/vision.mdx)
- [Product](docs/product/index.mdx)
- [Design](docs/design/index.mdx)
- [Reference](docs/reference/index.mdx)
- [Roadmap](docs/roadmap.mdx)
- [Glossary](docs/glossary.mdx)

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
