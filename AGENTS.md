# AGENTS.md

## Working in this repository

`docs/glossary.mdx` holds the ubiquitous language, `docs/` holds the
specification, and `docs/adr/` holds the repository conventions. Read those
before changing code. The docs are a Blume site: `pnpm docs:dev` serves it, and
every page is plain MDX on disk.
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

Postgres becomes the permanent financial truth once the service holds real
records. Its lifecycle is still infrastructure as code: Alchemy creates and
deletes the database and branches alongside the rest of the deployed stage.

- **Read freely; mutate through the declared workflow.** `pscale sql` defaults
  to `--role reader`; leave it there. Ad-hoc writer, admin, and force
  invocations need the operator's explicit approval first, per query.
- **Schema changes go through migrations in this repository**, never through an
  ad-hoc session. A migration is reviewed like any other code.
- **`main` is the production-designated branch.** Do not run ad-hoc writes,
  schema changes, resizes, or branch deletion against it. The production
  Alchemy deploy and destroy workflows own the database lifecycle and may
  create or delete it when the operator explicitly invokes that workflow.
- **Never copy production data into a development branch.** The database holds
  real financial records; a development branch is not an appropriate home for
  them, and each branch is billed for its own storage.
- Credentials belong in `.dev.vars` or Worker secrets, never in a committed
  file and never in the database.

## Cloudflare

The deployed topology — every Worker, binding, queue, bucket, gateway, and
Access policy — is defined in `infra/` and summarized in
[`infra/README.md`](./infra/README.md). `infra/src/worker-bindings.ts` is the
single definition of each Worker's environment; read it rather than trusting
a hand-written table, because a table here would drift.

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
