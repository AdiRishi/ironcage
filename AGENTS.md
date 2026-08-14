# AGENTS.md

## Working in this repository

`CONTEXT.md` holds the ubiquitous language, `docs/` holds the specification, and
`docs/adr/` holds the repository conventions. Read those before changing code.
This file covers the external services an agent can reach and what it may do
with them.

## PlanetScale

|                   |                               |
| ----------------- | ----------------------------- |
| Organization      | `arishi-personal-org`         |
| Database          | `ironcage`                    |
| Engine            | PostgreSQL                    |
| Region            | `aws-ap-southeast-2` (Sydney) |
| Production branch | `main`                        |

Postgres is the only permanent financial truth in this system, so the rules
around it are stricter than the CLI's defaults.

- **Read freely, write never.** `pscale sql` defaults to `--role reader`; leave
  it there. Any `--role writer`, `--role admin`, or `--force` invocation needs
  the operator's explicit approval first, per query.
- **Schema changes go through migrations in this repository**, never through an
  ad-hoc session. A migration is reviewed like any other code.
- **`main` is production.** Never run a write, a schema change, a resize, or a
  branch deletion against it. Development work targets a development branch.
- **Never copy production data into a development branch.** The database holds
  real financial records; a development branch is not an appropriate home for
  them, and each branch is billed for its own storage.
- Credentials belong in `.dev.vars` or Worker secrets, never in a committed
  file and never in the database.

## Cloudflare

| Binding            | Resource                               | Held by           |
| ------------------ | -------------------------------------- | ----------------- |
| `DB`               | Hyperdrive `ironcage-without-cache`    | `ironcage-core`   |
| `DB_CACHED`        | Hyperdrive `ironcage-with-cache`       | `ironcage-core`   |
| `BLOBS`            | R2 `ironcage-private`                  | `ironcage-core`   |
| `COMPUTE`          | Durable Object `BacktestRunner`        | `ironcage-core`   |
| `AGENTS`           | `ironcage-agents`, dispatch entrypoint | `ironcage-core`   |
| `CORE`             | `ironcage-core`, agent-read entrypoint | `ironcage-agents` |
| `CORE` / `AGENTS`  | operator and conversation entrypoints  | `ironcage-app`    |
| `DECISION_RECORDS` | Queue producer                         | `ironcage-agents` |
| Queue consumer     | `decision-records`, batch size one     | `ironcage-core`   |
| `FLAGS`            | Flagship kill-switch app               | core and agents   |
| `AI_GATEWAY`       | authenticated AI Gateway               | `ironcage-agents` |

Account: `Adishwar Rishi (Personal)`, `34c911069f69b7cc1f38573958c3db45`.

Creating, deleting, or reconfiguring any remote resource — a database branch, a
Hyperdrive configuration, a bucket, a queue — requires the operator's approval
first. Reading configuration does not.

## Local development

`pnpm dev` runs the Alchemy development stack. It starts all four Workers and
resolves their service, Durable Object, Workflow, Queue, R2, Hyperdrive,
Flagship, and AI Gateway bindings from the same Effect program used for
production.

There is no long-lived local Postgres. Alchemy connects the local Hyperdrive
bindings straight to the PlanetScale `dev` branch through managed development
roles. That direct path does not exercise deployed Hyperdrive pooling or
caching; a deployed dev Worker is what proves those. Database integration tests
start disposable Postgres containers and never use either PlanetScale branch.

R2 and Queues are simulated locally under `.alchemy/`. The development AI
Gateway and Flagship app are separate remote resources. Infrastructure
configuration and secrets come from `infra/.env` or `alchemy login`; production
credentials never belong in that file.

## Vendored Repositories

`.repos/` holds read-only vendored reference repos. See `.repos/AGENTS.md` for more details.

- When writing Effect code, read `.repos/effect/LLMS.md` first and inspect `.repos/effect/` for examples of idiomatic usage, tests, module structure, and API design.
