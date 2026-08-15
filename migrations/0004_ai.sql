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
  otel_trace_id        text,
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

CREATE TABLE capability_configs (
  capability text NOT NULL,
  version    integer NOT NULL CHECK (version > 0),
  model      text NOT NULL,
  enabled    boolean NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (capability, version)
);

INSERT INTO capability_configs (capability, version, model, enabled, created_at)
VALUES (
  'money.categorization',
  1,
  'cloudflare/@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  true,
  now()
);

CREATE TABLE categorization_batches (
  run_id         uuid PRIMARY KEY,
  import_id      uuid NOT NULL REFERENCES bank_imports(id),
  capability     text NOT NULL,
  bundle_digest  text NOT NULL CHECK (bundle_digest ~ '^[a-f0-9]{64}$'),
  batch_index    integer NOT NULL CHECK (batch_index >= 0),
  config_version integer NOT NULL CHECK (config_version > 0),
  input_digest   text NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  batch          jsonb NOT NULL,
  categories     jsonb NOT NULL,
  created_at     timestamptz NOT NULL,
  UNIQUE (import_id, batch_index, config_version),
  FOREIGN KEY (capability, config_version) REFERENCES capability_configs(capability, version)
);

CREATE TABLE categorization_batch_transactions (
  run_id         uuid NOT NULL REFERENCES categorization_batches(run_id),
  transaction_id uuid NOT NULL REFERENCES bank_transactions(id),
  ordinal        integer NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (run_id, transaction_id),
  UNIQUE (run_id, ordinal)
);

CREATE TABLE categorization_batch_categories (
  run_id      uuid NOT NULL REFERENCES categorization_batches(run_id),
  category_id uuid NOT NULL REFERENCES categories(id),
  PRIMARY KEY (run_id, category_id)
);

CREATE TABLE capability_dispatches (
  run_id        uuid PRIMARY KEY REFERENCES categorization_batches(run_id),
  status        text NOT NULL CHECK (status IN ('pending', 'dispatched')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error    text,
  created_at    timestamptz NOT NULL,
  dispatched_at timestamptz
);

CREATE INDEX capability_dispatches_pending
  ON capability_dispatches (created_at) WHERE status = 'pending';

CREATE UNIQUE INDEX transaction_splits_category_per_revision
  ON transaction_splits (transaction_id, revision, category_id);

CREATE FUNCTION assert_split_revision_balanced(
  target_transaction_id uuid,
  target_revision integer
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  transaction_amount numeric(20,8);
  split_total numeric(20,8);
BEGIN
  SELECT amount INTO STRICT transaction_amount
    FROM bank_transactions
   WHERE id = target_transaction_id;

  SELECT sum(amount) INTO split_total
    FROM transaction_splits
   WHERE transaction_id = target_transaction_id
     AND revision = target_revision;

  IF split_total IS NULL OR split_total <> transaction_amount THEN
    RAISE EXCEPTION 'split revision % for transaction % sums to %, expected %',
      target_revision, target_transaction_id, split_total, transaction_amount;
  END IF;
END;
$$;

CREATE FUNCTION check_split_revision_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM assert_split_revision_balanced(NEW.transaction_id, NEW.revision);
  END IF;

  IF TG_OP <> 'INSERT'
     AND (TG_OP = 'DELETE'
       OR OLD.transaction_id <> NEW.transaction_id
       OR OLD.revision <> NEW.revision) THEN
    PERFORM assert_split_revision_balanced(OLD.transaction_id, OLD.revision);
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER transaction_splits_balanced
AFTER INSERT OR UPDATE OR DELETE ON transaction_splits
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_split_revision_balance();
