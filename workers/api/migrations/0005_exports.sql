CREATE TABLE exports (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('processing', 'ready', 'failed')),
  include_sources BOOLEAN NOT NULL,
  manifest JSONB,
  object_key TEXT,
  expires_at TIMESTAMPTZ,
  failure JSONB,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX exports_requested ON exports (requested_at, id);
