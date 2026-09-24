-- A model answer below the auto-apply threshold that names an existing counterparty
-- proposes the alias instead of linking it. A proposed alias gives its transactions no
-- counterparty until you confirm it.
ALTER TABLE counterparty_aliases
  ADD COLUMN status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'proposed')),
  ADD COLUMN confidence NUMERIC(4, 3) CHECK (confidence BETWEEN 0 AND 1),
  ADD COLUMN reason TEXT;
