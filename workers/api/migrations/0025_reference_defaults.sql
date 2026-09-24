-- Payments to one counterparty can mean different things by reference, such as rent and
-- a bill split paid to the same person. A default for a reference key outranks the
-- counterparty's own default for the payments that carry it.
ALTER TABLE posting_descriptors ADD COLUMN reference_key TEXT;
CREATE INDEX posting_descriptors_reference ON posting_descriptors (reference_key);

CREATE TABLE counterparty_references (
  counterparty_id UUID NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  reference_key TEXT NOT NULL,
  default_role TEXT NOT NULL CHECK (default_role IN ('purchase', 'income', 'transfer', 'refund', 'reimbursement')),
  default_category_id UUID REFERENCES categories(id),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (counterparty_id, reference_key)
);
