# Migrations

Numbered SQL files, applied in order, never edited once applied. This schema
carries every guarantee in [Data](../docs/technical/03-data.md), so a migration
is reviewed like engine code.

## Writing one

Name the file `NNNN_lower_snake_name.sql`, taking the next unused number. Every
file declares how it can be checked:

```sql
-- verify: SELECT to_regclass('public.sleeves') IS NOT NULL

CREATE TABLE sleeves (
  id uuid PRIMARY KEY,
  ...
);
```

The runner applies the file in one transaction, then runs the `verify:` query
and requires it to return a single true value. A migration without one is
rejected, because a migration nobody can check is a migration nobody checked.

Changes are additive first: new columns arrive nullable or defaulted. A
destructive change ships in a later whole-system release, at least 7 days after
every reader and writer stopped using the old representation.

## Applying them

```sh
pnpm migrate        # show what would run, touch nothing
pnpm migrate:apply  # apply everything pending
```

`DATABASE_URL` must be a **direct** connection to the branch. Hyperdrive pools
in transaction mode, so the session advisory lock the runner takes would not
survive; the runner refuses a Hyperdrive URL rather than corrupting its own
mutual exclusion.

## What the runner refuses

It stops rather than guessing when an applied migration's checksum no longer
matches its file, when a file that was applied has disappeared, when a previous
run left a migration unfinished, or when a pending file numbers below one
already applied — the last being what happens when two branches both take the
next number.
