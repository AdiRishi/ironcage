# Ironcage

A personal wealth operating system: one engine running many investment
strategies, every one caged by deterministic risk rules, every one earning its
capital through evidence.

This file is the workstation front door. The system itself is specified in
[`docs/`](./docs/README.md), the ubiquitous language lives in
[`CONTEXT.md`](./CONTEXT.md), repository conventions live in
[`docs/adr/`](./docs/adr/README.md), and the rules for agents and external
services live in [`AGENTS.md`](./AGENTS.md).

## Prerequisites

- Node 24 — `.nvmrc` names the release; `corepack enable` provides pnpm.
- Docker — integration tests run disposable Postgres containers.
- Infrastructure credentials — only for `pnpm dev`, `plan`, and `deploy`; see
  [`infra/README.md`](./infra/README.md).

## Commands

```sh
pnpm install

pnpm dev        # the Alchemy dev stage: all four Workers and their bindings
pnpm check      # read-only gate: compile, lint, format check
pnpm fix        # the same gate, applying lint and format fixes
pnpm typecheck  # every package's production and test projects
pnpm test       # all tests, unit and integration
pnpm build      # production build of every workspace

pnpm plan       # preview the production infrastructure change
pnpm deploy     # reconcile production, including SQL migrations
```

CI runs `check`, `typecheck`, `build`, and `test` on every pull request. The
production deploy is a manually dispatched GitHub Actions workflow that runs
the same gates first.

## Layout

| Path          | Holds                                                        |
| ------------- | ------------------------------------------------------------ |
| `apps/`       | The four Workers: `app`, `core`, `agents`, `compute`         |
| `packages/`   | `domain`, `contracts`, `engine`, `tax`, `ui`                 |
| `infra/`      | The Alchemy stack — every resource and binding, typed        |
| `migrations/` | Numbered SQL files, applied in order, never edited           |
| `docs/`       | The specification: vision, product, technical chapters, ADRs |
| `.repos/`     | Read-only vendored reference source (see `.repos/AGENTS.md`) |
