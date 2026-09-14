CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'card', 'loan')),
  label TEXT NOT NULL,
  currency TEXT NOT NULL,
  bank_id TEXT,
  account_number TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX accounts_bank_identity ON accounts (COALESCE(bank_id, ''), account_number) WHERE account_number IS NOT NULL;
CREATE TABLE source_files (
  id UUID PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  object_key TEXT NOT NULL,
  bytes_available BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE imports (
  id UUID PRIMARY KEY,
  source_file_id UUID NOT NULL REFERENCES source_files(id),
  account_id UUID REFERENCES accounts(id),
  format TEXT NOT NULL CHECK (format IN ('csv', 'ofx')),
  parser_version TEXT NOT NULL,
  workflow_instance_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing', 'needs_review', 'complete', 'failed')),
  summary JSONB,
  failure JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX imports_created ON imports (created_at, id);
CREATE TABLE postings (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id),
  currency TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  posted_on DATE NOT NULL,
  value_on DATE,
  description TEXT NOT NULL,
  original_currency TEXT,
  original_amount_minor BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((original_currency IS NULL) = (original_amount_minor IS NULL))
);
CREATE INDEX postings_account_date ON postings (account_id, posted_on, id);
CREATE INDEX postings_date ON postings (posted_on, id);
CREATE TABLE observations (
  id UUID PRIMARY KEY,
  import_id UUID NOT NULL REFERENCES imports(id),
  source_file_id UUID NOT NULL REFERENCES source_files(id),
  locator_key TEXT NOT NULL,
  locator JSONB NOT NULL,
  raw JSONB NOT NULL,
  candidate JSONB,
  issue JSONB,
  posting_id UUID REFERENCES postings(id),
  match_method TEXT,
  match_evidence JSONB,
  UNIQUE (source_file_id, locator_key),
  UNIQUE (posting_id, source_file_id)
);
CREATE TABLE source_coverage (
  id UUID PRIMARY KEY,
  source_file_id UUID NOT NULL REFERENCES source_files(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  stated_start DATE,
  stated_end DATE,
  observed_start DATE NOT NULL,
  observed_end DATE NOT NULL,
  opening_minor BIGINT,
  opening_on DATE,
  closing_minor BIGINT,
  closing_on DATE,
  reconciled BOOLEAN NOT NULL,
  UNIQUE (source_file_id, account_id)
);
CREATE TABLE review_items (
  id UUID PRIMARY KEY,
  import_id UUID NOT NULL REFERENCES imports(id),
  kind TEXT NOT NULL CHECK (kind IN ('account', 'value', 'duplicate', 'source_conflict')),
  observation_ids UUID[] NOT NULL,
  question JSONB NOT NULL,
  candidates JSONB NOT NULL,
  resolution JSONB,
  resolved_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX review_items_open ON review_items (created_at, id) WHERE resolved_at IS NULL;
CREATE TABLE command_receipts (
  command_id UUID PRIMARY KEY,
  input_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  timezone TEXT NOT NULL,
  reporting_currency TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO settings (id, timezone, reporting_currency) VALUES (1, 'Australia/Sydney', 'AUD');
