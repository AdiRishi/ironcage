# Ironcage

Ironcage is Adi's personal finance platform. Its current product scope is complete spend management: a connected financial history, detailed trends, forecasts, and an analyst that retains useful context.

The documentation defines the product and target implementation. Investment, stock-trading, and crypto capabilities have a place in the broader vision, but their detailed specifications come later.

## Read the docs

The documentation is a [Blume](https://useblume.dev/) site. From the repository root:

```sh
pnpm docs:dev
```

Open the local URL printed by Blume. The docs server runs independently of the application and needs no Cloudflare credentials.

- [Vision](docs/vision.mdx)
- [Product behavior and user flows](docs/product/index.mdx)
- [Technical design](docs/technical/index.mdx)
- [Acceptance scenarios](docs/product/acceptance.mdx)

Edit pages in `docs/`. Run `pnpm docs:doctor` to check content and `pnpm docs:build` to generate the static site in `dist/`.

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
