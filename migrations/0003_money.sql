-- verify: SELECT to_regclass('public.bank_transactions') IS NOT NULL

-- The Money record: accounts, imports, source evidence, canonical
-- transactions, categorization, transfers, coverage, and the feed record the
-- import transaction writes into. Shapes follow docs/technical/08-money.mdx §8
-- and the conventions in docs/technical/03-data.mdx.

CREATE TABLE bank_accounts (
  id            uuid PRIMARY KEY,
  bank          text NOT NULL,
  product_label text NOT NULL,
  account_type  text NOT NULL CHECK (account_type IN ('deposit','credit_card','credit_line')),
  masked_suffix text NOT NULL,
  identity_hmac text NOT NULL,
  currency      text NOT NULL,
  required      boolean NOT NULL,
  opened_on     date,
  closed_on     date,
  created_at    timestamptz NOT NULL,
  UNIQUE (bank, identity_hmac)
);

CREATE TABLE bank_imports (
  id             uuid PRIMARY KEY,
  account_id     uuid NOT NULL REFERENCES bank_accounts(id),
  source_profile text NOT NULL,
  bundle_digest  text NOT NULL CHECK (bundle_digest ~ '^[a-f0-9]{64}$'),
  window_start   date NOT NULL,
  window_end     date NOT NULL CHECK (window_end >= window_start),
  status         text NOT NULL CHECK (status IN ('confirmed')),
  effects        jsonb NOT NULL,
  confirmed_at   timestamptz NOT NULL,
  UNIQUE (account_id, bundle_digest)
);

CREATE TABLE bank_source_files (
  id           uuid PRIMARY KEY,
  import_id    uuid NOT NULL REFERENCES bank_imports(id),
  role         text NOT NULL CHECK (role IN ('csv','ofx','pdf','extracted_markdown')),
  media_type   text NOT NULL,
  byte_digest  text NOT NULL CHECK (byte_digest ~ '^[a-f0-9]{64}$'),
  byte_size    integer NOT NULL CHECK (byte_size >= 0),
  r2_key       text NOT NULL,
  display_name text NOT NULL,
  extractor    jsonb,
  UNIQUE (import_id, role)
);

-- One row per bank-supplied representation of a movement. Reparsing under a
-- newer parser inserts a new row for the same (file, ordinal) and marks the
-- old one superseded; the raw cells are immutable.
CREATE TABLE bank_observations (
  id             uuid PRIMARY KEY,
  source_file_id uuid NOT NULL REFERENCES bank_source_files(id),
  source_ordinal integer NOT NULL CHECK (source_ordinal >= 0),
  raw            jsonb NOT NULL,
  parsed         jsonb NOT NULL,
  parser_version integer NOT NULL CHECK (parser_version > 0),
  parse_status   text NOT NULL CHECK (parse_status IN ('parsed','superseded')),
  UNIQUE (source_file_id, source_ordinal, parser_version)
);

-- The matching fields beside the display fields are derived under a versioned
-- normalizer; identity never depends on the display strings alone.
CREATE TABLE bank_transactions (
  id                    uuid PRIMARY KEY,
  account_id            uuid NOT NULL REFERENCES bank_accounts(id),
  posted_date           date NOT NULL,
  amount                numeric(20,8) NOT NULL,
  currency              text NOT NULL,
  display_narrative     text NOT NULL,
  derived_payee         text NOT NULL,
  narrative_fingerprint text NOT NULL,
  row_balance           numeric(20,8),
  normalizer_version    integer NOT NULL CHECK (normalizer_version > 0),
  created_by_import     uuid NOT NULL REFERENCES bank_imports(id),
  created_at            timestamptz NOT NULL
);

CREATE INDEX bank_transactions_matching
  ON bank_transactions (account_id, posted_date, amount);

CREATE TABLE bank_observation_links (
  id             uuid PRIMARY KEY,
  observation_id uuid NOT NULL UNIQUE REFERENCES bank_observations(id),
  transaction_id uuid NOT NULL REFERENCES bank_transactions(id),
  import_id      uuid NOT NULL REFERENCES bank_imports(id),
  match_tier     text NOT NULL CHECK (match_tier IN
                   ('bundle','identifier','row_balance','content','statement','new')),
  decided_by     text NOT NULL CHECK (decided_by IN ('cascade','operator')),
  created_at     timestamptz NOT NULL
);

CREATE INDEX bank_observation_links_transaction
  ON bank_observation_links (transaction_id);

-- Tier 1's verified-identifier lookup. A row exists only for source profiles
-- whose fixtures proved FITID stability; the unique key is the conflict check.
CREATE TABLE bank_source_identifiers (
  account_id     uuid NOT NULL REFERENCES bank_accounts(id),
  source_profile text NOT NULL,
  fitid          text NOT NULL,
  transaction_id uuid NOT NULL REFERENCES bank_transactions(id),
  PRIMARY KEY (account_id, source_profile, fitid)
);

CREATE TABLE bank_balance_observations (
  id             uuid PRIMARY KEY,
  account_id     uuid NOT NULL REFERENCES bank_accounts(id),
  kind           text NOT NULL CHECK (kind IN ('row','ledger','available','opening','closing')),
  value          numeric(20,8) NOT NULL,
  as_of_date     date NOT NULL,
  as_of_time     timestamptz,
  observation_id uuid REFERENCES bank_observations(id),
  source_file_id uuid REFERENCES bank_source_files(id),
  CHECK (observation_id IS NOT NULL OR source_file_id IS NOT NULL)
);

CREATE INDEX bank_balance_observations_latest
  ON bank_balance_observations (account_id, kind, as_of_date);

CREATE TABLE bank_coverage_segments (
  id             uuid PRIMARY KEY,
  account_id     uuid NOT NULL REFERENCES bank_accounts(id),
  start_date     date NOT NULL,
  end_date       date NOT NULL CHECK (end_date >= start_date),
  source_profile text NOT NULL,
  import_id      uuid NOT NULL REFERENCES bank_imports(id),
  status         text NOT NULL CHECK (status IN ('complete'))
);

CREATE INDEX bank_coverage_segments_account
  ON bank_coverage_segments (account_id, start_date);

CREATE TABLE bank_ambiguity_resolutions (
  id          uuid PRIMARY KEY,
  import_id   uuid NOT NULL REFERENCES bank_imports(id),
  subject     jsonb NOT NULL,
  resolution  jsonb NOT NULL,
  resolved_at timestamptz NOT NULL
);

CREATE TABLE categories (
  id         uuid PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  kind       text NOT NULL CHECK (kind IN ('expense','income')),
  system     boolean NOT NULL DEFAULT false,
  archived   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);

CREATE TABLE categorization_rules (
  id             uuid PRIMARY KEY,
  predicate      jsonb NOT NULL,
  category_id    uuid NOT NULL REFERENCES categories(id),
  created_by     text NOT NULL CHECK (created_by IN ('operator','correction')),
  effective_from timestamptz NOT NULL,
  effective_to   timestamptz,
  created_at     timestamptz NOT NULL
);

-- Effective splits are the highest revision for a transaction; a correction
-- appends the next revision rather than editing rows. The application asserts
-- each revision sums exactly to the transaction amount.
CREATE TABLE transaction_splits (
  id             uuid PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES bank_transactions(id),
  revision       integer NOT NULL CHECK (revision > 0),
  category_id    uuid NOT NULL REFERENCES categories(id),
  amount         numeric(20,8) NOT NULL,
  provenance     text NOT NULL CHECK (provenance IN ('system','rule','ai','manual')),
  rule_id        uuid REFERENCES categorization_rules(id),
  created_at     timestamptz NOT NULL
);

CREATE INDEX transaction_splits_effective
  ON transaction_splits (transaction_id, revision);

CREATE TABLE transfer_matches (
  id            uuid PRIMARY KEY,
  transaction_a uuid NOT NULL REFERENCES bank_transactions(id),
  transaction_b uuid NOT NULL REFERENCES bank_transactions(id),
  status        text NOT NULL CHECK (status IN ('proposed','confirmed','dismissed')),
  method        text NOT NULL CHECK (method IN ('sole_pairing','reference','operator')),
  provenance    jsonb NOT NULL,
  created_at    timestamptz NOT NULL,
  decided_at    timestamptz,
  CHECK (transaction_a <> transaction_b)
);

CREATE UNIQUE INDEX transfer_matches_effective_a
  ON transfer_matches (transaction_a) WHERE status IN ('proposed','confirmed');
CREATE UNIQUE INDEX transfer_matches_effective_b
  ON transfer_matches (transaction_b) WHERE status IN ('proposed','confirmed');

CREATE TABLE feed_events (
  id             uuid PRIMARY KEY,
  occurred_at    timestamptz NOT NULL,
  origin         text NOT NULL,
  category       text NOT NULL,
  event_type     text NOT NULL,
  severity       text NOT NULL CHECK (severity IN ('info','notice','warning','critical')),
  summary        text NOT NULL,
  payload        jsonb NOT NULL,
  correlation_id uuid,
  links          jsonb
);

CREATE TABLE acknowledgments (
  event_id        uuid PRIMARY KEY REFERENCES feed_events(id),
  acknowledged_at timestamptz NOT NULL
);

-- The system-owned initial category: every new transaction's first split lands
-- here until a rule, suggestion, or correction moves it. The fixed UUID lets
-- code name it without a lookup.
INSERT INTO categories (id, name, kind, system, created_at) VALUES
  ('01900000-0000-7000-8000-000000000001', 'uncategorized', 'expense', true, now());

INSERT INTO categories (id, name, kind, system, created_at) VALUES
  ('01900000-0000-7000-8000-000000000002', 'groceries',      'expense', false, now()),
  ('01900000-0000-7000-8000-000000000003', 'dining',         'expense', false, now()),
  ('01900000-0000-7000-8000-000000000004', 'transport',      'expense', false, now()),
  ('01900000-0000-7000-8000-000000000005', 'housing',        'expense', false, now()),
  ('01900000-0000-7000-8000-000000000006', 'utilities',      'expense', false, now()),
  ('01900000-0000-7000-8000-000000000007', 'insurance',      'expense', false, now()),
  ('01900000-0000-7000-8000-000000000008', 'health',         'expense', false, now()),
  ('01900000-0000-7000-8000-000000000009', 'subscriptions',  'expense', false, now()),
  ('01900000-0000-7000-8000-00000000000a', 'shopping',       'expense', false, now()),
  ('01900000-0000-7000-8000-00000000000b', 'entertainment',  'expense', false, now()),
  ('01900000-0000-7000-8000-00000000000c', 'travel',         'expense', false, now()),
  ('01900000-0000-7000-8000-00000000000d', 'education',      'expense', false, now()),
  ('01900000-0000-7000-8000-00000000000e', 'gifts',          'expense', false, now()),
  ('01900000-0000-7000-8000-00000000000f', 'fees',           'expense', false, now()),
  ('01900000-0000-7000-8000-000000000010', 'salary',         'income',  false, now()),
  ('01900000-0000-7000-8000-000000000011', 'interest',       'income',  false, now()),
  ('01900000-0000-7000-8000-000000000012', 'other income',   'income',  false, now());
