CREATE TABLE rules (
  id UUID PRIMARY KEY, name TEXT NOT NULL, conditions JSONB NOT NULL, action JSONB NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('past','future','both')), version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE rule_exceptions (
  rule_id UUID NOT NULL REFERENCES rules(id) ON DELETE CASCADE, event_id UUID NOT NULL REFERENCES events(id),
  PRIMARY KEY(rule_id,event_id)
);
CREATE TABLE rule_applications (
  event_id UUID PRIMARY KEY REFERENCES events(id), rule_ids UUID[] NOT NULL, prior JSONB NOT NULL
);
