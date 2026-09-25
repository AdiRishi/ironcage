-- Changes to counterparties, their descriptors, and their reference defaults are kept
-- with every record they wrote, as it was before and after, so any of them can be
-- undone. An alias gets its own version, so moving a descriptor does not conflict with
-- renaming the counterparty that held it.
ALTER TABLE counterparty_aliases ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- A correction either corrects an event or undoes a correction, and sets either the
-- role, purchase date, and allocations, or the event's counterparty. Every earlier
-- correction set the allocations.
ALTER TABLE corrections RENAME COLUMN scope TO action;
UPDATE corrections SET action = 'correct' WHERE action = 'event';
ALTER TABLE corrections
  ADD CONSTRAINT corrections_action_check CHECK (action IN ('correct', 'undo')),
  ADD COLUMN change TEXT NOT NULL DEFAULT 'allocations' CHECK (change IN ('allocations', 'counterparty'));
ALTER TABLE corrections ALTER COLUMN change DROP DEFAULT;

-- `images` holds the records a change wrote. An undo is a change of its own, and a
-- change is undone at most once.
CREATE TABLE counterparty_changes (
  id UUID PRIMARY KEY,
  command_id UUID NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('create', 'update', 'merge', 'moveAlias', 'saveReference', 'deleteReference', 'acceptCategory', 'undo')),
  undoes UUID UNIQUE REFERENCES counterparty_changes(id),
  images JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'undo') = (undoes IS NOT NULL))
);
-- The counterparties a change wrote, named as they were then. A merged counterparty is
-- deleted and keeps its history, so this names no foreign key.
CREATE TABLE counterparty_change_subjects (
  change_id UUID NOT NULL REFERENCES counterparty_changes(id) ON DELETE CASCADE,
  counterparty_id UUID NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (counterparty_id, change_id)
);
CREATE INDEX counterparty_change_subjects_change ON counterparty_change_subjects(change_id);
-- The transactions whose meaning a change altered.
CREATE TABLE counterparty_change_events (
  change_id UUID NOT NULL REFERENCES counterparty_changes(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id),
  PRIMARY KEY (event_id, change_id)
);
CREATE INDEX counterparty_change_events_change ON counterparty_change_events(change_id);

-- Searches match any part of a name or of the text the bank printed.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX posting_descriptors_counterparty_text_trgm ON posting_descriptors USING gin (counterparty_text gin_trgm_ops);
CREATE INDEX posting_descriptors_alias_key_trgm ON posting_descriptors USING gin (alias_key gin_trgm_ops);
CREATE INDEX counterparties_name_trgm ON counterparties USING gin (name gin_trgm_ops);
