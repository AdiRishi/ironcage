CREATE TABLE categories (
  id UUID PRIMARY KEY, parent_id UUID REFERENCES categories(id), name TEXT NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT false, version INTEGER NOT NULL DEFAULT 1,
  CHECK (id <> parent_id)
);
CREATE TABLE merchants (id UUID PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE merchant_aliases (merchant_id UUID NOT NULL REFERENCES merchants(id), pattern TEXT PRIMARY KEY);
CREATE TABLE tags (id UUID PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE personal_events (
  id UUID PRIMARY KEY, name TEXT NOT NULL, start_on DATE NOT NULL, end_on DATE NOT NULL,
  exclude_from_ordinary BOOLEAN NOT NULL DEFAULT false, version INTEGER NOT NULL DEFAULT 1,
  CHECK (end_on >= start_on)
);
CREATE TABLE events (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('purchase','income','transfer','cardSettlement','borrowing','loanPayment','refund','reimbursement','financingCost','unresolved')),
  currency TEXT NOT NULL, magnitude_minor BIGINT NOT NULL CHECK (magnitude_minor >= 0),
  primary_posting_id UUID NOT NULL REFERENCES postings(id),
  reporting_account_id UUID NOT NULL REFERENCES accounts(id), purchase_on DATE,
  active BOOLEAN NOT NULL DEFAULT true, suggestion JSONB, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE event_postings (
  event_id UUID NOT NULL REFERENCES events(id), posting_id UUID NOT NULL REFERENCES postings(id),
  active BOOLEAN NOT NULL DEFAULT true, PRIMARY KEY (event_id, posting_id)
);
CREATE UNIQUE INDEX posting_active_event ON event_postings(posting_id) WHERE active;
CREATE TABLE allocations (
  id UUID PRIMARY KEY, event_id UUID NOT NULL REFERENCES events(id),
  role TEXT NOT NULL CHECK (role IN ('purchase','income','transfer','borrowing','refund','reimbursement','financingCost','unresolved')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0), category_id UUID REFERENCES categories(id),
  merchant_id UUID REFERENCES merchants(id), non_personal BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX allocations_event ON allocations(event_id);
CREATE TABLE allocation_tags (
  allocation_id UUID NOT NULL REFERENCES allocations(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id), PRIMARY KEY (allocation_id, tag_id)
);
CREATE TABLE allocation_personal_events (
  allocation_id UUID NOT NULL REFERENCES allocations(id) ON DELETE CASCADE,
  personal_event_id UUID NOT NULL REFERENCES personal_events(id), PRIMARY KEY (allocation_id, personal_event_id)
);
ALTER TABLE review_items ALTER COLUMN import_id DROP NOT NULL;
ALTER TABLE review_items DROP CONSTRAINT review_items_kind_check;
ALTER TABLE review_items ADD CONSTRAINT review_items_kind_check CHECK (kind IN ('account','value','duplicate','source_conflict','role','relationship','ruleConflict'));
ALTER TABLE review_items ADD COLUMN event_ids UUID[] NOT NULL DEFAULT '{}';
INSERT INTO categories (id, name) VALUES
  ('00000000-0000-4000-8000-000000000001','Groceries'),
  ('00000000-0000-4000-8000-000000000002','Household'),
  ('00000000-0000-4000-8000-000000000003','Dining'),
  ('00000000-0000-4000-8000-000000000004','Transport'),
  ('00000000-0000-4000-8000-000000000005','Housing'),
  ('00000000-0000-4000-8000-000000000006','Health'),
  ('00000000-0000-4000-8000-000000000007','Leisure'),
  ('00000000-0000-4000-8000-000000000008','Interest and fees');
