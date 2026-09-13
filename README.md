# Ironcage

Ironcage is a private personal finance platform for one user. It is built in seven stages, starting with transaction uploads and recorded history. Each stage delivers a working frontend and backend before the next adds more behavior.

Start with [Delivery stages](docs/stages/index.mdx) and [Build one stage](docs/technical/build-spend-management.mdx). Stage 1 is the default implementation target. The documentation preserves the full product plan as stage-scoped references. Investment, stock-trading, and crypto capabilities have a place in the broader vision, but their detailed specifications come later.

## Read the docs

Read the [published documentation](https://adirishi.github.io/ironcage/). To run the [Blume](https://useblume.dev/) site locally, use this command from the repository root:

```sh
pnpm docs:dev
```

Open the local URL printed by Blume. The docs server runs independently of the application and needs no Cloudflare credentials.

- [Delivery stages](docs/stages/index.mdx)
- [Architecture and ownership](docs/technical/architecture.mdx)
- [Vision](docs/vision.mdx)
- [Product behavior and user flows](docs/product/index.mdx)
- [Technical design](docs/technical/index.mdx)
- [Acceptance scenarios](docs/product/acceptance.mdx)

Edit pages in `docs/`. Run `pnpm docs:doctor` to check content and `pnpm docs:build` to generate the static site in `dist/`.

The Documentation workflow builds and validates pull requests that affect the docs. Pushes to `main` publish the site through GitHub Pages.

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
