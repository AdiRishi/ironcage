-- verify: SELECT to_regclass('public.bank_transactions') IS NOT NULL AND to_regclass('public.monthly_spending_reports') IS NOT NULL

CREATE TABLE feed_events (
  id             uuid PRIMARY KEY,
  occurred_at    timestamptz NOT NULL,
  origin         text NOT NULL,
  category       text NOT NULL,
  event_type     text NOT NULL CHECK (event_type IN (
    'bank_import_completed',
    'bank_gap_detected',
    'bank_gap_closed',
    'recurring_price_change',
    'spending_anomaly',
    'report_generated',
    'report_failed',
    'ai_run_failed',
    'decision_record_lost'
  )),
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

CREATE TABLE app_requests (
  request_id   uuid PRIMARY KEY,
  operation    text NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  response     jsonb NOT NULL,
  completed_at timestamptz NOT NULL
);

CREATE TABLE bank_accounts (
  id             uuid PRIMARY KEY,
  bank_profile   text NOT NULL CHECK (bank_profile = 'commbank'),
  product_profile text NOT NULL UNIQUE CHECK (product_profile IN (
    'spending-offset','savings-offset','mastercard','home-loan'
  )),
  product_label  text NOT NULL UNIQUE,
  account_type   text NOT NULL CHECK (account_type IN ('deposit','credit_card','credit_line')),
  masked_suffix  text NOT NULL CHECK (masked_suffix ~ '^\d{4}$'),
  identity_hmac  text NOT NULL CHECK (identity_hmac ~ '^[a-f0-9]{64}$'),
  currency       text NOT NULL CHECK (currency = 'AUD'),
  required       boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL,
  effective_to   date,
  created_at     timestamptz NOT NULL,
  UNIQUE (bank_profile, identity_hmac),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (
    (product_profile IN ('spending-offset','savings-offset') AND account_type = 'deposit') OR
    (product_profile = 'mastercard' AND account_type = 'credit_card') OR
    (product_profile = 'home-loan' AND account_type = 'credit_line')
  )
);

CREATE TABLE bank_imports (
  id                    uuid PRIMARY KEY,
  bank_account_id       uuid NOT NULL REFERENCES bank_accounts(id),
  profile_version       text NOT NULL,
  bundle_digest         text NOT NULL CHECK (bundle_digest ~ '^[a-f0-9]{64}$'),
  preview_fingerprint   text NOT NULL CHECK (preview_fingerprint ~ '^[a-f0-9]{64}$'),
  source_start          date NOT NULL,
  source_end            date NOT NULL,
  status                text NOT NULL CHECK (status = 'confirmed'),
  source_transactions   integer NOT NULL CHECK (source_transactions >= 0),
  observation_count     integer NOT NULL CHECK (observation_count >= 0),
  new_transactions      integer NOT NULL CHECK (new_transactions >= 0),
  duplicate_transactions integer NOT NULL CHECK (duplicate_transactions >= 0),
  resolved_ambiguities  integer NOT NULL CHECK (resolved_ambiguities >= 0),
  result                jsonb NOT NULL,
  preview               jsonb NOT NULL,
  confirmed_at          timestamptz NOT NULL,
  UNIQUE (bank_account_id, bundle_digest),
  CHECK (source_end >= source_start)
);

CREATE TABLE bank_source_files (
  id                uuid PRIMARY KEY,
  bank_import_id    uuid NOT NULL REFERENCES bank_imports(id),
  role              text NOT NULL CHECK (role IN ('csv','ofx','pdf','extracted_markdown')),
  media_type        text NOT NULL,
  byte_digest       text NOT NULL CHECK (byte_digest ~ '^[a-f0-9]{64}$'),
  r2_key            text NOT NULL,
  original_name     text NOT NULL,
  extractor_metadata jsonb,
  byte_length       integer NOT NULL CHECK (byte_length >= 0),
  UNIQUE (bank_import_id, role)
);

CREATE TABLE bank_statement_archives (
  id              uuid PRIMARY KEY,
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
  byte_digest     text NOT NULL CHECK (byte_digest ~ '^[a-f0-9]{64}$'),
  r2_key          text NOT NULL,
  original_name   text NOT NULL,
  media_type      text NOT NULL CHECK (media_type = 'application/pdf'),
  byte_length     integer NOT NULL CHECK (byte_length > 0),
  archived_at     timestamptz NOT NULL,
  UNIQUE (bank_account_id, byte_digest)
);

CREATE TABLE bank_transactions (
  id                          uuid PRIMARY KEY,
  bank_account_id             uuid NOT NULL REFERENCES bank_accounts(id),
  posted_date                 date NOT NULL,
  amount                      numeric(20,8) NOT NULL,
  preferred_display_narrative text NOT NULL,
  creation_import_id          uuid NOT NULL REFERENCES bank_imports(id),
  created_at                  timestamptz NOT NULL
);

CREATE INDEX bank_transactions_account_date_idx
  ON bank_transactions (bank_account_id, posted_date, id);

CREATE TABLE bank_observations (
  id                    uuid PRIMARY KEY,
  source_file_id        uuid NOT NULL REFERENCES bank_source_files(id),
  source_ordinal        integer NOT NULL CHECK (source_ordinal >= 0),
  source_kind           text NOT NULL CHECK (source_kind IN ('csv','ofx','statement')),
  raw_fields            jsonb NOT NULL,
  parsed_fields         jsonb NOT NULL,
  posted_date           date NOT NULL,
  amount                numeric(20,8) NOT NULL,
  row_balance           numeric(20,8),
  bank_identifier       text,
  narrative_fingerprint text NOT NULL,
  equal_row_occurrence  integer NOT NULL CHECK (equal_row_occurrence > 0),
  parser_version        text NOT NULL,
  normalizer_version    text NOT NULL,
  parse_status          text NOT NULL CHECK (parse_status = 'parsed'),
  UNIQUE (source_file_id, source_ordinal)
);

CREATE UNIQUE INDEX bank_observations_stable_identifier_idx
  ON bank_observations (source_file_id, bank_identifier)
  WHERE bank_identifier IS NOT NULL;

CREATE TABLE bank_observation_links (
  observation_id uuid PRIMARY KEY REFERENCES bank_observations(id),
  transaction_id uuid NOT NULL REFERENCES bank_transactions(id),
  match_tier     text NOT NULL CHECK (match_tier IN (
    'new','bank_identifier','row_balance','content_occurrence','manual'
  )),
  provenance     jsonb NOT NULL,
  linked_at      timestamptz NOT NULL
);

CREATE INDEX bank_observation_links_transaction_idx
  ON bank_observation_links (transaction_id, observation_id);

CREATE TABLE bank_transaction_identifiers (
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
  source_profile  text NOT NULL,
  bank_identifier text NOT NULL,
  transaction_id  uuid NOT NULL REFERENCES bank_transactions(id),
  PRIMARY KEY (bank_account_id, source_profile, bank_identifier)
);

CREATE TABLE bank_balance_observations (
  id                    uuid PRIMARY KEY,
  bank_account_id       uuid NOT NULL REFERENCES bank_accounts(id),
  kind                  text NOT NULL CHECK (kind IN ('row','ledger','available','opening','closing')),
  value                 numeric(20,8) NOT NULL,
  source_value          numeric(20,8) NOT NULL,
  as_of_date            date NOT NULL,
  as_of_at              timestamptz,
  source_observation_id uuid REFERENCES bank_observations(id),
  source_file_id        uuid REFERENCES bank_source_files(id),
  recorded_at           timestamptz NOT NULL,
  CHECK (num_nonnulls(source_observation_id, source_file_id) = 1)
);

CREATE INDEX bank_balance_observations_latest_idx
  ON bank_balance_observations (bank_account_id, kind, as_of_date DESC, recorded_at DESC);

CREATE TABLE bank_coverage_segments (
  id                uuid PRIMARY KEY,
  bank_account_id   uuid NOT NULL REFERENCES bank_accounts(id),
  start_date        date NOT NULL,
  end_date          date NOT NULL,
  source_profile    text NOT NULL,
  bank_import_id    uuid NOT NULL REFERENCES bank_imports(id),
  status            text NOT NULL CHECK (status = 'complete'),
  recorded_at       timestamptz NOT NULL,
  UNIQUE (bank_account_id, bank_import_id),
  CHECK (end_date >= start_date)
);

CREATE INDEX bank_coverage_segments_account_window_idx
  ON bank_coverage_segments (bank_account_id, start_date, end_date);

CREATE TABLE bank_month_coverage_observations (
  id              uuid PRIMARY KEY,
  bank_import_id  uuid NOT NULL REFERENCES bank_imports(id),
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
  calendar_month  text NOT NULL CHECK (calendar_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  complete        boolean NOT NULL,
  feed_event_id   uuid REFERENCES feed_events(id),
  observed_at     timestamptz NOT NULL,
  observed_order  bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  UNIQUE (bank_import_id, bank_account_id, calendar_month)
);

CREATE INDEX bank_month_coverage_latest_idx
  ON bank_month_coverage_observations (bank_account_id, calendar_month, observed_order DESC);

CREATE TABLE money_categories (
  id         uuid PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('expense','income')),
  system     boolean NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE money_category_versions (
  category_id uuid NOT NULL REFERENCES money_categories(id),
  version     integer NOT NULL CHECK (version > 0),
  name        text NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (category_id, version)
);

INSERT INTO money_categories (id, kind, system, created_at) VALUES
  ('018f0000-0000-7000-8000-000000000001','expense',true,'2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-000000000002','expense',false,'2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-000000000003','expense',false,'2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-000000000004','expense',false,'2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-000000000005','expense',false,'2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-000000000006','expense',false,'2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-000000000007','expense',false,'2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-000000000008','expense',false,'2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-000000000009','expense',false,'2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-00000000000a','expense',false,'2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-00000000000b','income',false,'2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-00000000000c','expense',false,'2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-00000000000d','expense',false,'2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-00000000000e','expense',false,'2026-08-11T00:00:00Z');

INSERT INTO money_category_versions (category_id, version, name, recorded_at) VALUES
  ('018f0000-0000-7000-8000-000000000001',1,'Uncategorized','2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-000000000002',1,'Housing','2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-000000000003',1,'Groceries','2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-000000000004',1,'Eating out','2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-000000000005',1,'Transport','2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-000000000006',1,'Utilities','2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-000000000007',1,'Subscriptions','2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-000000000008',1,'Health','2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-000000000009',1,'Travel','2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-00000000000a',1,'Shopping','2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-00000000000b',1,'Income','2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-00000000000c',1,'Fees','2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-00000000000d',1,'Other','2026-08-11T00:00:00Z'),
  ('018f0000-0000-7000-8000-00000000000e',1,'Transfers','2026-08-11T00:00:00Z');

CREATE TABLE transaction_classifications (
  id             uuid PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES bank_transactions(id),
  provenance     text NOT NULL CHECK (provenance IN ('rule','ai','manual','system')),
  source_id      uuid,
  source_version integer,
  expected_total numeric(20,8) NOT NULL,
  recorded_at    timestamptz NOT NULL,
  CHECK (
    (provenance = 'rule' AND
      source_id IS NOT NULL AND source_version IS NOT NULL AND source_version > 0) OR
    (provenance = 'ai' AND source_id IS NOT NULL AND source_version IS NULL) OR
    (provenance IN ('manual','system') AND source_id IS NULL AND source_version IS NULL)
  )
);

CREATE INDEX transaction_classifications_effective_idx
  ON transaction_classifications (transaction_id, recorded_at DESC, id DESC);

CREATE TABLE transaction_splits (
  id                uuid PRIMARY KEY,
  classification_id uuid NOT NULL REFERENCES transaction_classifications(id),
  category_id       uuid NOT NULL REFERENCES money_categories(id),
  amount            numeric(20,8) NOT NULL
);

CREATE FUNCTION enforce_balanced_transaction_classification() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  classification uuid;
  expected numeric(20,8);
  transaction_total numeric(20,8);
  actual numeric(20,8);
BEGIN
  classification := CASE
    WHEN TG_TABLE_NAME = 'transaction_classifications' THEN NEW.id
    ELSE NEW.classification_id
  END;

  SELECT c.expected_total, t.amount INTO expected, transaction_total
    FROM transaction_classifications c
    JOIN bank_transactions t ON t.id = c.transaction_id
    WHERE c.id = classification;
  SELECT COALESCE(SUM(amount), 0) INTO actual
    FROM transaction_splits
    WHERE classification_id = classification;

  IF expected IS DISTINCT FROM transaction_total THEN
    RAISE EXCEPTION 'classification % total %, transaction total %',
      classification, expected, transaction_total;
  END IF;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'classification % splits total %, expected %', classification, actual, expected;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER transaction_classifications_balance
AFTER INSERT ON transaction_classifications
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_balanced_transaction_classification();

CREATE CONSTRAINT TRIGGER transaction_splits_balance
AFTER INSERT ON transaction_splits
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_balanced_transaction_classification();

CREATE TABLE categorization_rules (
  id             uuid NOT NULL,
  version        integer NOT NULL CHECK (version > 0),
  name           text NOT NULL,
  predicate      jsonb NOT NULL,
  category_id    uuid NOT NULL REFERENCES money_categories(id),
  effective_from date NOT NULL,
  retired_at     timestamptz,
  recorded_at    timestamptz NOT NULL,
  PRIMARY KEY (id, version)
);

ALTER TABLE transaction_classifications
  ADD CONSTRAINT transaction_classifications_rule_source
  FOREIGN KEY (source_id, source_version) REFERENCES categorization_rules (id, version);

CREATE TABLE decision_records (
  id                   uuid PRIMARY KEY,
  capability           text NOT NULL,
  asked                text NOT NULL,
  inputs_summary       jsonb NOT NULL,
  decided              jsonb NOT NULL,
  rationale            text NOT NULL,
  model                text NOT NULL,
  config_version       integer NOT NULL,
  gateway_log_ids      text[] NOT NULL DEFAULT '{}',
  otel_trace_id        text NOT NULL,
  otel_parent_span_ids text[] NOT NULL DEFAULT '{}',
  occurred_at          timestamptz NOT NULL
);

CREATE TABLE capability_outputs (
  run_id         uuid PRIMARY KEY,
  capability     text NOT NULL,
  sleeve_id      uuid REFERENCES sleeves(id),
  scheduled_at   timestamptz NOT NULL,
  output         jsonb,
  failure        jsonb,
  payload_hash   text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  config_version integer NOT NULL,
  produced_at    timestamptz NOT NULL,
  valid_until    timestamptz NOT NULL,
  CHECK (num_nonnulls(output, failure) = 1)
);

CREATE TABLE queue_dedupe (
  run_id      uuid PRIMARY KEY REFERENCES capability_outputs(run_id),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  consumed_at timestamptz NOT NULL
);

CREATE TABLE categorization_suggestions (
  id                 uuid PRIMARY KEY,
  transaction_id     uuid NOT NULL REFERENCES bank_transactions(id),
  splits             jsonb NOT NULL,
  confidence         numeric(10,8) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  rationale          text NOT NULL,
  decision_record_id uuid NOT NULL REFERENCES decision_records(id),
  status             text NOT NULL CHECK (status IN ('pending','accepted','rejected')),
  created_at         timestamptz NOT NULL,
  resolved_at        timestamptz
);

CREATE INDEX categorization_suggestions_review_idx
  ON categorization_suggestions (status, created_at, id);

CREATE TABLE transfer_matches (
  id                    uuid PRIMARY KEY,
  debit_transaction_id  uuid NOT NULL REFERENCES bank_transactions(id),
  credit_transaction_id uuid NOT NULL REFERENCES bank_transactions(id),
  status                text NOT NULL CHECK (status IN ('proposed','confirmed','rejected')),
  method                text NOT NULL CHECK (method IN ('unique','reference','amount_date','manual')),
  provenance            jsonb NOT NULL,
  recorded_at           timestamptz NOT NULL,
  CHECK (debit_transaction_id <> credit_transaction_id),
  UNIQUE (debit_transaction_id, credit_transaction_id)
);

CREATE UNIQUE INDEX transfer_matches_effective_debit_idx
  ON transfer_matches (debit_transaction_id) WHERE status = 'confirmed';
CREATE UNIQUE INDEX transfer_matches_effective_credit_idx
  ON transfer_matches (credit_transaction_id) WHERE status = 'confirmed';

CREATE TABLE monthly_spending_reports (
  id                         uuid PRIMARY KEY,
  report_month               text NOT NULL CHECK (report_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  generated_at               timestamptz NOT NULL,
  read_at                    timestamptz,
  data_through               date NOT NULL,
  analysis                   jsonb NOT NULL,
  recurring_charges          jsonb NOT NULL,
  anomalies                  jsonb NOT NULL,
  suggestions                jsonb NOT NULL,
  supporting_transaction_ids uuid[] NOT NULL,
  body_key                   text NOT NULL UNIQUE,
  UNIQUE (report_month)
);

CREATE TABLE money_analysis_events (
  rule          text NOT NULL,
  subject       text NOT NULL,
  calendar_month text NOT NULL CHECK (calendar_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  feed_event_id uuid NOT NULL REFERENCES feed_events(id),
  PRIMARY KEY (rule, subject, calendar_month)
);
