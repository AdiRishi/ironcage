ALTER TABLE observations ADD COLUMN parsed_candidate JSONB;
ALTER TABLE observations ADD COLUMN decision JSONB;
UPDATE observations SET parsed_candidate = candidate;
