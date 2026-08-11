-- verify: SELECT bool_and(prosrc LIKE '%IF TG_TABLE_NAME%') FROM pg_proc WHERE proname = 'enforce_balanced_transaction_classification'

-- PL/pgSQL resolves every field reference in an expression when it prepares
-- that expression, not when a branch is taken. The `CASE` this function used
-- named `NEW.classification_id`, which does not exist on
-- `transaction_classifications`, so the deferred check raised 42703 at COMMIT
-- and no import could ever be confirmed. Branching in statements rather than in
-- one expression means each side is only compiled where its record has the
-- field.
CREATE OR REPLACE FUNCTION enforce_balanced_transaction_classification() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  classification uuid;
  expected numeric(20,8);
  transaction_total numeric(20,8);
  actual numeric(20,8);
BEGIN
  IF TG_TABLE_NAME = 'transaction_classifications' THEN
    classification := NEW.id;
  ELSE
    classification := NEW.classification_id;
  END IF;

  SELECT c.expected_total, t.amount INTO expected, transaction_total
    FROM transaction_classifications c
    JOIN bank_transactions t ON t.id = c.transaction_id
    WHERE c.id = classification;
  SELECT COALESCE(SUM(amount), 0) INTO actual
    FROM transaction_splits
    WHERE classification_id = classification;

  IF expected IS DISTINCT FROM transaction_total THEN
    RAISE EXCEPTION 'classification % total %, transaction total %',
      classification, expected, transaction_total;
  END IF;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'classification % splits total %, expected %', classification, actual, expected;
  END IF;
  RETURN NEW;
END;
$$;
