-- verify: SELECT to_regclass('public.bank_transaction_identifiers') IS NULL
--   AND EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_name = 'bank_transactions' AND column_name = 'derived_payee')

-- The payee a source profile derives from a narrative, applied once at import.
-- Analysis reads this column instead of re-deriving a payee in SQL under rules
-- that had already drifted from the importer's.
ALTER TABLE bank_transactions ADD COLUMN derived_payee text NOT NULL DEFAULT '';
ALTER TABLE bank_transactions ALTER COLUMN derived_payee DROP DEFAULT;

CREATE INDEX bank_transactions_payee_idx ON bank_transactions (derived_payee, posted_date);

-- Every observed CommBank export already signs a liability balance the way
-- Portfolio reads it, so no configured profile normalizes one. A column that
-- can only ever equal `value` records nothing.
ALTER TABLE bank_balance_observations DROP COLUMN source_value;

-- Written by every import and read by nothing: deduplication resolves a bank
-- identifier through the observation that carries it.
DROP TABLE bank_transaction_identifiers;
