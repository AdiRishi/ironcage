CREATE TABLE corrections (
  id UUID PRIMARY KEY, event_id UUID NOT NULL REFERENCES events(id), command_id UUID NOT NULL,
  prior JSONB NOT NULL, accepted JSONB NOT NULL, scope TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX corrections_event ON corrections(event_id, created_at, id);
