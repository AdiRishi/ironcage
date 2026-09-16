CREATE TABLE classification_settings (
  id INTEGER PRIMARY KEY CHECK(id=1), enabled BOOLEAN NOT NULL DEFAULT false, warning_minor BIGINT CHECK(warning_minor>0), version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO classification_settings(id,warning_minor) VALUES(1,500);
CREATE TABLE classification_runs (
  id UUID PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed')),
  model TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),requested INTEGER NOT NULL,failure TEXT
);
CREATE TABLE classification_items (
  run_id UUID NOT NULL REFERENCES classification_runs(id),event_id UUID NOT NULL REFERENCES events(id),event_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','suggested','skipped','failed')),
  PRIMARY KEY(run_id,event_id)
);

