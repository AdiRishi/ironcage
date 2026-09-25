-- A number opens the records behind it. Each fact names the posting its money moved
-- through, and a linked credit's reduction names the credit's event, whose primary
-- posting is the record behind it. Existing facts take their event's primary posting
-- until the facts rebuild for this derivation replaces them.
--
-- Facts no longer carry a top-level category or read a counterparty's kind: scopes read
-- the category tree when they are queried, so moving a category or changing a
-- counterparty's kind changes no fact.
ALTER TABLE ledger_facts
  ADD COLUMN posting_id UUID REFERENCES postings(id),
  ADD COLUMN credit_event_id UUID REFERENCES events(id),
  DROP COLUMN top_category_id;
UPDATE ledger_facts f SET posting_id = e.primary_posting_id FROM events e WHERE e.id = f.event_id;
ALTER TABLE ledger_facts ALTER COLUMN posting_id SET NOT NULL;

DROP TRIGGER categories_update_facts ON categories;
DROP FUNCTION note_category_events();

CREATE OR REPLACE FUNCTION note_counterparty_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM note_fact_events(ARRAY(
    SELECT e.id FROM new_rows n JOIN old_rows o ON o.id = n.id JOIN events e ON e.counterparty_id = n.id
    WHERE n.source IS DISTINCT FROM o.source));
  RETURN NULL;
END $$;
