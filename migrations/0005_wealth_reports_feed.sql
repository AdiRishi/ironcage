-- verify: SELECT to_regclass('public.reports') IS NOT NULL

ALTER TABLE feed_events
  ADD COLUMN sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE;

CREATE TABLE external_accounts (
  id         uuid PRIMARY KEY,
  label      text NOT NULL UNIQUE,
  kind       text NOT NULL CHECK (kind IN ('asset', 'liability')),
  currency   text NOT NULL CHECK (currency = 'AUD'),
  archived   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);

CREATE TABLE external_balance_observations (
  id           uuid PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES external_accounts(id),
  balance      numeric(20,8) NOT NULL,
  balance_date date NOT NULL,
  observed_at  timestamptz NOT NULL
);

CREATE INDEX external_balance_observations_latest
  ON external_balance_observations (account_id, observed_at DESC);

CREATE TABLE reports (
  id           uuid PRIMARY KEY,
  report_type  text NOT NULL CHECK (report_type IN ('monthly_spending')),
  title        text NOT NULL,
  period_start date NOT NULL,
  period_end   date NOT NULL CHECK (period_end >= period_start),
  content      jsonb NOT NULL,
  generated_at timestamptz NOT NULL,
  opened_at    timestamptz,
  UNIQUE (report_type, period_start, period_end)
);

CREATE TABLE system_state (
  singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mode       text NOT NULL CHECK (mode IN ('running', 'halted')),
  reason     text,
  changed_at timestamptz NOT NULL
);

INSERT INTO system_state (singleton, mode, changed_at) VALUES (true, 'running', now());

CREATE TABLE feed_dispatches (
  event_id      uuid PRIMARY KEY REFERENCES feed_events(id),
  status        text NOT NULL CHECK (status IN ('pending', 'dispatched')),
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  created_at    timestamptz NOT NULL,
  dispatched_at timestamptz
);
