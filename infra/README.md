# Infrastructure

[`alchemy.run.ts`](./alchemy.run.ts) is the only infrastructure definition for
Ironcage. It is an Effect program that owns the complete Cloudflare deployment
and the PlanetScale resources used by it. There are no checked-in Wrangler
configuration files and no separate migration command.

## Commands

Copy `.env.example` to `.env` in this directory, or authenticate with
`alchemy login` and provide the remaining application configuration through the
process environment.

```sh
pnpm dev     # Alchemy dev stage: all four Workers and their bindings
pnpm plan    # production plan
pnpm deploy  # production reconciliation, including SQL migrations
```

`pnpm dev` keeps Worker, R2, and Queue state local under `.alchemy/`. It uses
the real PlanetScale `dev` branch through Alchemy-managed runtime
roles, and it uses separate remote development AI Gateway and Flagship
resources. It never receives production venue credentials.

There is deliberately no production destroy script. Permanent stores and
safety control-plane resources use Alchemy retention policies as another guard
against accidental removal.

Production deployment is a manually dispatched GitHub Actions workflow scoped
to the `production` environment. It runs the complete repository verification
before a non-interactive Alchemy reconcile. The manual gate remains in place
until the application implements the entry block and whole-system release
verification required for safe automatic deployment from `main`.

## Managed topology

| Area        | Resources                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime     | app, core, agents, and compute Workers; named service entrypoints; actor and compute Durable Objects; six Workflows; system Cron triggers            |
| Database    | adopted PlanetScale Postgres database and `dev` branch; isolated runtime roles; read-only backup role; cached and uncached Hyperdrive configurations |
| Storage     | private blob, agent-artifact quarantine, and backup R2 buckets; incomplete-upload cleanup and production indefinite bucket locks                     |
| Messaging   | decision-record Queue, DLQ, single-message core consumer, 14-day production retention                                                                |
| AI controls | authenticated AI Gateways with response caching disabled, bounded logs, spend caps, and production/development separation                            |
| Safety      | production and development Flagship apps; global live-trading brake defaulted off                                                                    |
| Edge        | TanStack Start Website, custom domain, Cloudflare Access application and operator policy with phishing-resistant MFA                                 |
| State       | encrypted remote Cloudflare state for deployed stacks; local state ignored by git                                                                    |

Alchemy has first-class providers for the topology itself. The small providers
in [`src/cloudflare-settings.ts`](./src/cloudflare-settings.ts) cover three
Cloudflare settings that Alchemy does not yet expose directly: R2 bucket locks,
Queue message retention, and Access MFA configuration. They participate in the
same plan/reconcile/state lifecycle as first-class resources.

## Migrations and first adoption

Both PlanetScale branches consume the numbered SQL files in `../migrations`.
Alchemy creates a short-lived migration role, applies each pending file in a
transaction, records its filename in `__alchemy_migrations`, and removes the
role. Migration credentials never enter a developer file or Hyperdrive.

The database is shared between stages, so the development stack references the
production stack's adopted database resource. The production resource must be
adopted into Alchemy state before the first `pnpm dev`. Initial state-store
creation and adoption are remote changes and require the same explicit operator
approval as any other infrastructure change.

An existing development schema created by the retired `schema_migrations`
runner must be reset or deliberately baselined before its first Alchemy
reconcile. Do not manufacture `__alchemy_migrations` rows for a schema whose
contents have not been verified.
