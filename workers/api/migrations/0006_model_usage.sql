CREATE TABLE model_usage (
  id UUID PRIMARY KEY,
  task TEXT NOT NULL,
  model TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  input_tokens BIGINT,
  output_tokens BIGINT,
  cost_minor BIGINT,
  cost_currency TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  CHECK ((cost_minor IS NULL) = (cost_currency IS NULL))
);
ALTER TABLE settings ADD COLUMN ai_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN ai_warning_minor BIGINT;
