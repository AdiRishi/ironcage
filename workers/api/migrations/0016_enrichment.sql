CREATE TABLE enrichment_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT false,
  warning_minor BIGINT CHECK (warning_minor > 0),
  auto_apply_confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.8 CHECK (auto_apply_confidence BETWEEN 0 AND 1),
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO enrichment_settings (id, warning_minor) VALUES (1, 2000);

CREATE TABLE enrichment_runs (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested INTEGER NOT NULL,
  failure TEXT
);
CREATE TABLE enrichment_items (
  run_id UUID NOT NULL REFERENCES enrichment_runs(id),
  alias_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'skipped', 'failed')),
  PRIMARY KEY (run_id, alias_key)
);

-- Subcategories the model would like to exist. You accept or dismiss them.
CREATE TABLE category_proposals (
  id UUID PRIMARY KEY,
  parent_id UUID NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  reason TEXT NOT NULL,
  alias_keys TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_id, name)
);
