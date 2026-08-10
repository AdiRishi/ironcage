-- verify: SELECT to_regclass('public.sleeve_transitions') IS NOT NULL

-- The sleeve and its lifecycle history. `state` and `paused` are the only
-- mutable columns here, and every change to either appends a transition row in
-- the same transaction. The remaining tables of docs/technical/03-data.md
-- arrive with the code that reads them.

CREATE TABLE sleeves (
  id             uuid PRIMARY KEY,
  name           text NOT NULL UNIQUE,
  market         text NOT NULL CHECK (market IN ('crypto','stocks')),
  state          text NOT NULL CHECK (state IN ('draft','dry_run','live','halted','retired')),
  paused         boolean NOT NULL DEFAULT false,
  shadow         boolean NOT NULL DEFAULT false,
  active_mandate integer NOT NULL,
  created_at     timestamptz NOT NULL
);

CREATE TABLE sleeve_transitions (
  id           uuid PRIMARY KEY,
  sleeve_id    uuid NOT NULL REFERENCES sleeves(id),
  from_state   text NOT NULL,
  to_state     text NOT NULL,
  triggered_by text NOT NULL,
  reason       text NOT NULL,
  ceremony_id  uuid,
  occurred_at  timestamptz NOT NULL
);
