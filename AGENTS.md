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

| Binding           | Resource                               | Held by           |
| ----------------- | -------------------------------------- | ----------------- |
| `DB`              | Hyperdrive `ironcage-without-cache`    | `ironcage-core`   |
| `DB_CACHED`       | Hyperdrive `ironcage-with-cache`       | `ironcage-core`   |
| `BLOBS`           | R2 `ironcage-private`                  | `ironcage-core`   |
| `COMPUTE`         | Durable Object `BacktestRunner`        | `ironcage-core`   |
| `AGENTS`          | `ironcage-agents`, dispatch entrypoint | `ironcage-core`   |
| `CORE`            | `ironcage-core`, agent-read entrypoint | `ironcage-agents` |
| `CORE` / `AGENTS` | operator and conversation entrypoints  | `ironcage-app`    |

Account: `Adishwar Rishi (Personal)`, `34c911069f69b7cc1f38573958c3db45`.

Creating, deleting, or reconfiguring any remote resource — a database branch, a
Hyperdrive configuration, a bucket, a queue — requires the operator's approval
first. Reading configuration does not.

## Local development

`pnpm dev` starts all four Workers with the local dev registry resolving every
service binding.

There is no local Postgres. `wrangler dev` connects straight to the PlanetScale
`dev` branch through `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB` and
`..._DB_CACHED` in `apps/core/.env`. Those are Wrangler's own variables rather
than Worker bindings, so they belong in `.env` — Wrangler does not read
`.dev.vars` for them. The connection reaches the database directly, exercising
neither Hyperdrive's pooling nor its caching; a deployed dev Worker is what
would prove those.

R2 is simulated locally in `.wrangler/state` and does not touch
`ironcage-private` unless the binding is marked `"remote": true`.

## Vendored Repositories

`.repos/` holds read-only vendored reference repos. See `.repos/AGENTS.md` for more details.

- When writing Effect code, read `.repos/effect/LLMS.md` first and inspect `.repos/effect/` for examples of idiomatic usage, tests, module structure, and API design.
