CREATE TABLE movement_links (
  event_id UUID PRIMARY KEY REFERENCES events(id), from_endpoint JSONB NOT NULL, to_endpoint JSONB NOT NULL,
  evidence JSONB NOT NULL, original_event JSONB NOT NULL, absorbed_event_id UUID REFERENCES events(id)
);
CREATE TABLE credit_links (
  id UUID PRIMARY KEY, credit_allocation_id UUID NOT NULL REFERENCES allocations(id),
  cost_allocation_id UUID NOT NULL REFERENCES allocations(id), amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  CHECK (credit_allocation_id <> cost_allocation_id)
);
CREATE INDEX credit_links_credit ON credit_links(credit_allocation_id);
CREATE INDEX credit_links_cost ON credit_links(cost_allocation_id);
CREATE TABLE fee_associations (
  fee_event_id UUID PRIMARY KEY REFERENCES events(id), purchase_event_id UUID NOT NULL REFERENCES events(id),
  status TEXT NOT NULL CHECK (status IN ('proposed','confirmed')), CHECK (fee_event_id <> purchase_event_id)
);
CREATE TABLE offset_relationships (
  id UUID PRIMARY KEY, deposit_account_id UUID NOT NULL REFERENCES accounts(id), loan_account_id UUID NOT NULL REFERENCES accounts(id),
  start_on DATE NOT NULL, end_on DATE, version INTEGER NOT NULL DEFAULT 1, CHECK (end_on IS NULL OR end_on > start_on)
);
CREATE TABLE account_periods (
  id UUID PRIMARY KEY, account_id UUID NOT NULL REFERENCES accounts(id), start_on DATE NOT NULL, end_on DATE,
  label TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, CHECK (end_on IS NULL OR end_on > start_on)
);
