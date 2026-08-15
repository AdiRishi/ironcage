-- verify: SELECT to_regclass('public.decision_records') IS NOT NULL

-- The AI runtime record: consumed-run deduplication, validated capability
-- outputs, permanent decision records, and Money's categorization review
-- suggestions. Shapes follow docs/technical/03-data.mdx.

CREATE TABLE queue_dedupe (
  run_id       uuid PRIMARY KEY,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  consumed_at  timestamptz NOT NULL
);

CREATE TABLE capability_outputs (
  run_id         uuid PRIMARY KEY,
  capability     text NOT NULL,
  sleeve_id      uuid REFERENCES sleeves(id),
  trigger        jsonb NOT NULL,
  scheduled_at   timestamptz,
  output         jsonb,
  failure        jsonb,
  payload_hash   text NOT NULL,
  config_version integer NOT NULL,
  produced_at    timestamptz NOT NULL,
  valid_until    timestamptz
);

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

-- The model's assignment for one transaction: applied as that transaction's
-- effective split (with `ai` provenance) the moment the run lands, and kept
-- here for its rationale and its link to the decision record. When the
-- operator later files the row themselves the status says whether they kept
-- the model's category or overrode it — the correction corpus.
CREATE TABLE categorization_assignments (
  id                 uuid PRIMARY KEY,
  run_id             uuid NOT NULL REFERENCES capability_outputs(run_id),
  transaction_id     uuid NOT NULL REFERENCES bank_transactions(id),
  category_id        uuid NOT NULL REFERENCES categories(id),
  rationale          text NOT NULL,
  decision_record_id uuid NOT NULL REFERENCES decision_records(id),
  status             text NOT NULL CHECK (status IN ('applied','kept','overridden')),
  created_at         timestamptz NOT NULL
);

-- One live model assignment per transaction.
CREATE UNIQUE INDEX categorization_assignments_applied
  ON categorization_assignments (transaction_id) WHERE status = 'applied';
