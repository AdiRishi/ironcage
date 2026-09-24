-- Each event records which derivation built its facts, so a change to the derivation
-- rebuilds older facts in the background instead of inside someone's command.
ALTER TABLE events ADD COLUMN facts_version INTEGER NOT NULL DEFAULT 0;
CREATE INDEX events_facts_version ON events (facts_version);

CREATE OR REPLACE FUNCTION mark_event_facts_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.facts_stale = OLD.facts_stale
    AND (to_jsonb(NEW) - 'facts_stale' - 'facts_version') IS DISTINCT FROM (to_jsonb(OLD) - 'facts_stale' - 'facts_version') THEN
    NEW.facts_stale := true;
  END IF;
  RETURN NEW;
END $$;

-- The Workflow instance rebuilding facts for each derivation version.
CREATE TABLE fact_rebuilds (
  version INTEGER PRIMARY KEY,
  instance_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
