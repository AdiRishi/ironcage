-- Accounts, imports, and descriptors name the institution whose formats they use, so a
-- second bank adds a descriptor profile and parsers instead of changing the engine.
ALTER TABLE accounts ADD COLUMN institution TEXT NOT NULL DEFAULT 'commbank'
  CHECK (institution IN ('commbank'));
ALTER TABLE accounts ALTER COLUMN institution DROP DEFAULT;
DROP INDEX accounts_bank_identity;
CREATE UNIQUE INDEX accounts_bank_identity ON accounts (institution, COALESCE(bank_id, ''), account_number)
  WHERE account_number IS NOT NULL;

ALTER TABLE imports ADD COLUMN institution TEXT NOT NULL DEFAULT 'commbank'
  CHECK (institution IN ('commbank'));
ALTER TABLE imports ALTER COLUMN institution DROP DEFAULT;

ALTER TABLE posting_descriptors ADD COLUMN profile TEXT NOT NULL DEFAULT 'commbank';
ALTER TABLE posting_descriptors ALTER COLUMN profile DROP DEFAULT;
