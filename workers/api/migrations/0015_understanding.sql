-- Taxonomy: two trees, two levels, stable slugs. The eight original categories keep their IDs.
ALTER TABLE categories
  ADD COLUMN slug TEXT UNIQUE,
  ADD COLUMN tree TEXT NOT NULL DEFAULT 'spending' CHECK (tree IN ('spending', 'income')),
  ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
INSERT INTO categories (id, parent_id, slug, name, tree, position) VALUES
  ('00000000-0000-4000-8000-000000000005', NULL, 'housing', 'Housing', 'spending', 0),
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000005', 'housing.rent', 'Rent', 'spending', 0),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000005', 'housing.mortgage-interest', 'Mortgage interest', 'spending', 1),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000005', 'housing.strata', 'Strata', 'spending', 2),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000005', 'housing.rates', 'Rates', 'spending', 3),
  ('00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000005', 'housing.maintenance', 'Maintenance', 'spending', 4),
  ('00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000005', 'housing.home-insurance', 'Home insurance', 'spending', 5),
  ('00000000-0000-4000-8000-000000000107', NULL, 'bills', 'Bills and utilities', 'spending', 1),
  ('00000000-0000-4000-8000-000000000108', '00000000-0000-4000-8000-000000000107', 'bills.electricity', 'Electricity', 'spending', 0),
  ('00000000-0000-4000-8000-000000000109', '00000000-0000-4000-8000-000000000107', 'bills.gas', 'Gas', 'spending', 1),
  ('00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000107', 'bills.water', 'Water', 'spending', 2),
  ('00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000107', 'bills.internet', 'Internet', 'spending', 3),
  ('00000000-0000-4000-8000-000000000112', '00000000-0000-4000-8000-000000000107', 'bills.phone', 'Phone', 'spending', 4),
  ('00000000-0000-4000-8000-000000000113', NULL, 'food', 'Food', 'spending', 2),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000113', 'food.groceries', 'Groceries', 'spending', 0),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000113', 'food.dining-out', 'Dining out', 'spending', 1),
  ('00000000-0000-4000-8000-000000000114', '00000000-0000-4000-8000-000000000113', 'food.delivery', 'Delivery', 'spending', 2),
  ('00000000-0000-4000-8000-000000000115', '00000000-0000-4000-8000-000000000113', 'food.coffee', 'Coffee', 'spending', 3),
  ('00000000-0000-4000-8000-000000000116', '00000000-0000-4000-8000-000000000113', 'food.alcohol', 'Alcohol', 'spending', 4),
  ('00000000-0000-4000-8000-000000000004', NULL, 'transport', 'Transport', 'spending', 3),
  ('00000000-0000-4000-8000-000000000117', '00000000-0000-4000-8000-000000000004', 'transport.fuel', 'Fuel', 'spending', 0),
  ('00000000-0000-4000-8000-000000000118', '00000000-0000-4000-8000-000000000004', 'transport.public-transport', 'Public transport', 'spending', 1),
  ('00000000-0000-4000-8000-000000000119', '00000000-0000-4000-8000-000000000004', 'transport.rideshare', 'Rideshare', 'spending', 2),
  ('00000000-0000-4000-8000-000000000120', '00000000-0000-4000-8000-000000000004', 'transport.parking-and-tolls', 'Parking and tolls', 'spending', 3),
  ('00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000004', 'transport.car-maintenance', 'Car maintenance', 'spending', 4),
  ('00000000-0000-4000-8000-000000000122', '00000000-0000-4000-8000-000000000004', 'transport.car-insurance', 'Car insurance', 'spending', 5),
  ('00000000-0000-4000-8000-000000000123', '00000000-0000-4000-8000-000000000004', 'transport.registration', 'Registration', 'spending', 6),
  ('00000000-0000-4000-8000-000000000124', NULL, 'shopping', 'Shopping', 'spending', 4),
  ('00000000-0000-4000-8000-000000000125', '00000000-0000-4000-8000-000000000124', 'shopping.general', 'General', 'spending', 0),
  ('00000000-0000-4000-8000-000000000126', '00000000-0000-4000-8000-000000000124', 'shopping.clothing', 'Clothing', 'spending', 1),
  ('00000000-0000-4000-8000-000000000127', '00000000-0000-4000-8000-000000000124', 'shopping.electronics', 'Electronics', 'spending', 2),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000124', 'shopping.home', 'Home and furniture', 'spending', 3),
  ('00000000-0000-4000-8000-000000000128', '00000000-0000-4000-8000-000000000124', 'shopping.gifts', 'Gifts', 'spending', 4),
  ('00000000-0000-4000-8000-000000000006', NULL, 'health', 'Health', 'spending', 5),
  ('00000000-0000-4000-8000-000000000129', '00000000-0000-4000-8000-000000000006', 'health.medical', 'Medical', 'spending', 0),
  ('00000000-0000-4000-8000-000000000130', '00000000-0000-4000-8000-000000000006', 'health.pharmacy', 'Pharmacy', 'spending', 1),
  ('00000000-0000-4000-8000-000000000131', '00000000-0000-4000-8000-000000000006', 'health.dental', 'Dental', 'spending', 2),
  ('00000000-0000-4000-8000-000000000132', '00000000-0000-4000-8000-000000000006', 'health.fitness', 'Fitness', 'spending', 3),
  ('00000000-0000-4000-8000-000000000133', '00000000-0000-4000-8000-000000000006', 'health.health-insurance', 'Health insurance', 'spending', 4),
  ('00000000-0000-4000-8000-000000000134', NULL, 'personal-care', 'Personal care', 'spending', 6),
  ('00000000-0000-4000-8000-000000000135', '00000000-0000-4000-8000-000000000134', 'personal-care.hair-and-beauty', 'Hair and beauty', 'spending', 0),
  ('00000000-0000-4000-8000-000000000136', '00000000-0000-4000-8000-000000000134', 'personal-care.personal-care', 'Personal care products', 'spending', 1),
  ('00000000-0000-4000-8000-000000000007', NULL, 'entertainment', 'Entertainment', 'spending', 7),
  ('00000000-0000-4000-8000-000000000137', '00000000-0000-4000-8000-000000000007', 'entertainment.streaming', 'Streaming', 'spending', 0),
  ('00000000-0000-4000-8000-000000000138', '00000000-0000-4000-8000-000000000007', 'entertainment.events', 'Events', 'spending', 1),
  ('00000000-0000-4000-8000-000000000139', '00000000-0000-4000-8000-000000000007', 'entertainment.games', 'Games', 'spending', 2),
  ('00000000-0000-4000-8000-000000000140', '00000000-0000-4000-8000-000000000007', 'entertainment.hobbies', 'Hobbies', 'spending', 3),
  ('00000000-0000-4000-8000-000000000141', NULL, 'travel', 'Travel', 'spending', 8),
  ('00000000-0000-4000-8000-000000000142', '00000000-0000-4000-8000-000000000141', 'travel.flights', 'Flights', 'spending', 0),
  ('00000000-0000-4000-8000-000000000143', '00000000-0000-4000-8000-000000000141', 'travel.accommodation', 'Accommodation', 'spending', 1),
  ('00000000-0000-4000-8000-000000000144', '00000000-0000-4000-8000-000000000141', 'travel.activities', 'Travel activities', 'spending', 2),
  ('00000000-0000-4000-8000-000000000145', NULL, 'subscriptions', 'Subscriptions', 'spending', 9),
  ('00000000-0000-4000-8000-000000000146', '00000000-0000-4000-8000-000000000145', 'subscriptions.software', 'Software', 'spending', 0),
  ('00000000-0000-4000-8000-000000000147', '00000000-0000-4000-8000-000000000145', 'subscriptions.news-and-media', 'News and media', 'spending', 1),
  ('00000000-0000-4000-8000-000000000148', '00000000-0000-4000-8000-000000000145', 'subscriptions.memberships', 'Memberships', 'spending', 2),
  ('00000000-0000-4000-8000-000000000149', NULL, 'education', 'Education', 'spending', 10),
  ('00000000-0000-4000-8000-000000000150', '00000000-0000-4000-8000-000000000149', 'education.courses', 'Courses', 'spending', 0),
  ('00000000-0000-4000-8000-000000000151', '00000000-0000-4000-8000-000000000149', 'education.books', 'Books', 'spending', 1),
  ('00000000-0000-4000-8000-000000000152', NULL, 'giving', 'Giving', 'spending', 11),
  ('00000000-0000-4000-8000-000000000153', '00000000-0000-4000-8000-000000000152', 'giving.donations', 'Donations', 'spending', 0),
  ('00000000-0000-4000-8000-000000000154', '00000000-0000-4000-8000-000000000152', 'giving.gifts-to-people', 'Gifts to people', 'spending', 1),
  ('00000000-0000-4000-8000-000000000008', NULL, 'fees-and-interest', 'Fees and interest', 'spending', 12),
  ('00000000-0000-4000-8000-000000000155', '00000000-0000-4000-8000-000000000008', 'fees-and-interest.bank-fees', 'Bank fees', 'spending', 0),
  ('00000000-0000-4000-8000-000000000156', '00000000-0000-4000-8000-000000000008', 'fees-and-interest.foreign-transaction-fees', 'Foreign transaction fees', 'spending', 1),
  ('00000000-0000-4000-8000-000000000157', '00000000-0000-4000-8000-000000000008', 'fees-and-interest.card-interest', 'Card interest', 'spending', 2),
  ('00000000-0000-4000-8000-000000000158', NULL, 'government', 'Government', 'spending', 13),
  ('00000000-0000-4000-8000-000000000159', '00000000-0000-4000-8000-000000000158', 'government.tax', 'Tax', 'spending', 0),
  ('00000000-0000-4000-8000-000000000160', '00000000-0000-4000-8000-000000000158', 'government.fines', 'Fines', 'spending', 1),
  ('00000000-0000-4000-8000-000000000161', NULL, 'cash', 'Cash', 'spending', 14),
  ('00000000-0000-4000-8000-000000000162', '00000000-0000-4000-8000-000000000161', 'cash.withdrawals', 'Cash withdrawals', 'spending', 0),
  ('00000000-0000-4000-8000-000000000163', NULL, 'income-salary', 'Salary', 'income', 15),
  ('00000000-0000-4000-8000-000000000164', NULL, 'income-interest', 'Interest', 'income', 16),
  ('00000000-0000-4000-8000-000000000165', NULL, 'income-refunds', 'Refunds and reimbursements', 'income', 17),
  ('00000000-0000-4000-8000-000000000166', NULL, 'income-government', 'Government', 'income', 18),
  ('00000000-0000-4000-8000-000000000167', NULL, 'income-other', 'Other income', 'income', 19)
ON CONFLICT (id) DO UPDATE SET parent_id = EXCLUDED.parent_id, slug = EXCLUDED.slug, name = EXCLUDED.name, tree = EXCLUDED.tree, position = EXCLUDED.position, archived = false;

-- Counterparties replace merchants.
CREATE TABLE counterparties (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('business', 'person', 'ownAccount', 'institution')),
  brand TEXT,
  default_category_id UUID REFERENCES categories(id),
  default_role TEXT CHECK (default_role IN ('purchase', 'income', 'transfer', 'refund', 'reimbursement')),
  source TEXT NOT NULL CHECK (source IN ('user', 'model')),
  status TEXT NOT NULL CHECK (status IN ('applied', 'proposed')),
  model TEXT,
  confidence NUMERIC(4, 3) CHECK (confidence BETWEEN 0 AND 1),
  reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source = 'model' OR status = 'applied')
);
CREATE TABLE counterparty_aliases (
  alias_key TEXT PRIMARY KEY,
  counterparty_id UUID NOT NULL REFERENCES counterparties(id),
  source TEXT NOT NULL CHECK (source IN ('user', 'model')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX counterparty_aliases_counterparty ON counterparty_aliases(counterparty_id);

CREATE TABLE posting_descriptors (
  posting_id UUID PRIMARY KEY REFERENCES postings(id),
  profile_version INTEGER NOT NULL,
  channel TEXT NOT NULL,
  counterparty_text TEXT,
  alias_key TEXT,
  card_suffix TEXT,
  own_account_suffix TEXT,
  pay_id TEXT,
  reference TEXT,
  foreign_currency TEXT,
  foreign_amount TEXT
);
CREATE INDEX posting_descriptors_alias ON posting_descriptors(alias_key);

-- Every assignment records its source. Existing hand corrections and movement links keep theirs;
-- everything else is derived again by the next reinterpretation.
ALTER TABLE events
  ADD COLUMN counterparty_id UUID REFERENCES counterparties(id),
  ADD COLUMN counterparty_source TEXT CHECK (counterparty_source IN ('user', 'alias')),
  ADD COLUMN role_source TEXT CHECK (role_source IN ('user', 'rule', 'bank', 'counterparty', 'link')),
  DROP COLUMN suggestion;
CREATE INDEX events_counterparty ON events(counterparty_id) WHERE active;
UPDATE events e SET role_source = 'link' WHERE EXISTS (SELECT 1 FROM movement_links m WHERE m.event_id = e.id);
UPDATE events e SET role_source = 'user'
  WHERE role_source IS NULL AND EXISTS (SELECT 1 FROM corrections c WHERE c.event_id = e.id AND c.scope IN ('event', 'undo'));

ALTER TABLE allocations
  ADD COLUMN category_source TEXT CHECK (category_source IN ('user', 'rule', 'counterparty', 'bank')),
  DROP COLUMN merchant_id;
UPDATE allocations a SET category_source = CASE
  WHEN EXISTS (SELECT 1 FROM rule_applications r WHERE r.event_id = a.event_id) THEN 'rule' ELSE 'user' END
  WHERE category_id IS NOT NULL;

DROP TABLE merchant_aliases;
DROP TABLE merchants;

-- Stored event snapshots gain the same provenance fields.
CREATE FUNCTION pg_temp.upgrade_event(e jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT (e - 'suggestion') || jsonb_build_object(
    'roleSource', NULL, 'counterpartyId', NULL, 'counterpartySource', NULL,
    'allocations', (SELECT jsonb_agg((a - 'merchantId') || jsonb_build_object(
      'categorySource', CASE WHEN a->>'categoryId' IS NULL THEN NULL ELSE 'user' END))
      FROM jsonb_array_elements(e->'allocations') a))
$$;
UPDATE corrections SET prior = pg_temp.upgrade_event(prior), accepted = pg_temp.upgrade_event(accepted);
UPDATE movement_links SET original_event = pg_temp.upgrade_event(original_event);

-- Rules match counterparties and channels. Stored snapshots follow the same shape.
UPDATE rules SET conditions = (conditions - 'merchantId') || '{"counterpartyId": null, "channel": null}'::jsonb;
UPDATE rule_applications SET applied_rules = COALESCE((
  SELECT jsonb_agg(jsonb_set(r, '{conditions}', ((r->'conditions') - 'merchantId') || '{"counterpartyId": null, "channel": null}'::jsonb))
  FROM jsonb_array_elements(applied_rules) r), '[]'::jsonb);
ALTER TABLE rule_applications DROP COLUMN prior;

-- Interpretation questions are computed from current records, so stored per-event items go.
DELETE FROM review_items WHERE kind IN ('role', 'ruleConflict');
ALTER TABLE review_items DROP CONSTRAINT review_items_kind_check;
ALTER TABLE review_items ADD CONSTRAINT review_items_kind_check
  CHECK (kind IN ('account', 'value', 'duplicate', 'source_conflict', 'relationship'));

-- Per-transaction suggestions give way to counterparty enrichment.
DROP TABLE classification_items;
DROP TABLE classification_runs;
DROP TABLE classification_settings;
