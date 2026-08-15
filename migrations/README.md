# Migrations

Numbered SQL files are applied in order. Before the first deployment, rewrite
and squash them into the clearest cold schema. Once a file has been applied,
its name and contents are immutable. This schema
carries every guarantee in [Data](../docs/technical/03-data.md), so a migration
is reviewed like engine code.

## Writing one

Name the file `NNNN_lower_snake_name.sql`, taking the next unused number. Keep
each file executable as one PostgreSQL transaction:

```sql
CREATE TABLE sleeves (
  id uuid PRIMARY KEY,
  ...
);
```

Changes are additive first: new columns arrive nullable or defaulted. A
destructive change ships in a later whole-system release, at least 7 days after
every reader and writer stopped using the old representation.

## Applying them

```sh
pnpm plan    # preview the complete production infrastructure change
pnpm deploy  # reconcile the stack and apply pending migrations
```

PlanetScale is part of the Alchemy stack. Alchemy reads the numbered SQL files,
creates a short-lived PlanetScale migration role, applies each pending file in
its own transaction, and records the filename in `__alchemy_migrations`. The
role is deleted after the run and has a bounded TTL if cleanup fails. `pnpm dev`
does the same for the `dev` branch; production deployments target `main` and
remain subject to PlanetScale's deploy approval.

Do not edit a migration after it has been deployed. Alchemy includes migration
content hashes in its infrastructure state, so a changed file is visible in the
plan even though the database ledger identifies it by filename.

Database integration tests use Postgres 18.4 in Testcontainers. Each database
test file owns a container, and every test drops the entire `public` schema and
executes the repository SQL again before it runs. That test fixture validates a
cold schema and real PostgreSQL behavior without duplicating Alchemy's
PlanetScale deployment runner or connecting to either remote branch.

## What the runner refuses

It stops rather than guessing when an applied migration's checksum no longer
matches its file, when a file that was applied has disappeared, when a previous
run left a migration unfinished, or when a pending file numbers below one
already applied — the last being what happens when two branches both take the
next number.
