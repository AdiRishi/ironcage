-- verify: SELECT NOT EXISTS (
--   SELECT 1 FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name = 'bank_source_files'
--     AND column_name = 'r2_key'
-- )

DROP TABLE IF EXISTS bank_statement_archives;

ALTER TABLE bank_source_files
  DROP COLUMN IF EXISTS r2_key;
