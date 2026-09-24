-- An evaluation run asks the model about aliases you already answered, without showing
-- it your answers, and scores what it says against yours instead of applying it. Your
-- answer is copied when the run starts, so later edits do not change its score.
ALTER TABLE enrichment_runs ADD COLUMN purpose TEXT NOT NULL DEFAULT 'identify'
  CHECK (purpose IN ('identify', 'evaluate'));
CREATE TABLE enrichment_evaluations (
  run_id UUID NOT NULL REFERENCES enrichment_runs(id) ON DELETE CASCADE,
  alias_key TEXT NOT NULL,
  counterparty_id UUID NOT NULL,
  expected JSONB NOT NULL,
  predicted JSONB,
  PRIMARY KEY (run_id, alias_key)
);
