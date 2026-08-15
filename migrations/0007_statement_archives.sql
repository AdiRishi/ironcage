-- verify: SELECT to_regclass('public.bank_statement_archives') IS NOT NULL

CREATE TABLE bank_statement_archives (
  id           uuid PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES bank_accounts(id),
  display_name text NOT NULL,
  byte_digest  text NOT NULL CHECK (byte_digest ~ '^[a-f0-9]{64}$'),
  byte_size    integer NOT NULL CHECK (byte_size > 0),
  r2_key       text NOT NULL,
  archived_at  timestamptz NOT NULL,
  UNIQUE (account_id, byte_digest)
);
