# Ironcage

Ironcage is a private personal finance application for one user. It is built in seven stages, starting with uploading CommBank exports and recording every posting once. Each stage delivers a working frontend and backend before the next adds more.

Nothing has shipped yet. The repository is a Cloudflare starter that stage 1 replaces. Start with [Starting point](docs/stages/starting-point.mdx), then [stage 1](docs/stages/record-transactions.mdx).

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
