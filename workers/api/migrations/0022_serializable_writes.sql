-- Writes run as serializable transactions without a global lock. A stale flag on
-- `events` would make every write read one shared index, so concurrent writes always
-- conflicted. Instead each statement notes the events whose facts it changed in a
-- transaction-local setting, and the transaction refreshes exactly those before it
-- commits. Nothing about it is visible to, or conflicts with, another transaction.
DROP TRIGGER events_facts_stale ON events;
DROP TRIGGER allocations_facts_stale ON allocations;
DROP TRIGGER credit_links_facts_stale ON credit_links;
DROP TRIGGER counterparties_facts_stale ON counterparties;
DROP TRIGGER categories_facts_stale ON categories;
DROP TRIGGER postings_facts_stale ON postings;
DROP FUNCTION mark_event_facts_stale();
DROP FUNCTION mark_allocation_event_stale();
DROP FUNCTION mark_credit_events_stale();
DROP FUNCTION mark_counterparty_events_stale();
DROP FUNCTION mark_category_events_stale();
DROP FUNCTION mark_posting_events_stale();
DROP INDEX events_facts_stale;
ALTER TABLE events DROP COLUMN facts_stale;

CREATE FUNCTION note_fact_events(ids UUID[]) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('ironcage.fact_events', array_to_string(ARRAY(
    SELECT DISTINCT id FROM unnest(
      COALESCE(string_to_array(NULLIF(current_setting('ironcage.fact_events', true), ''), ',')::UUID[], '{}') || ids
    ) AS id WHERE id IS NOT NULL), ','), true);
$$;

-- Any column other than the version that built the facts can change them.
CREATE FUNCTION note_changed_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM note_fact_events(ARRAY(SELECT id FROM new_rows));
  ELSE
    PERFORM note_fact_events(ARRAY(
      SELECT n.id FROM new_rows n JOIN old_rows o ON o.id = n.id
      WHERE (to_jsonb(n) - 'facts_version') IS DISTINCT FROM (to_jsonb(o) - 'facts_version')));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER events_insert_facts AFTER INSERT ON events
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_changed_events();
CREATE TRIGGER events_update_facts AFTER UPDATE ON events
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_changed_events();

-- Rows that belong to one event: allocations and posting membership.
CREATE FUNCTION note_member_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM note_fact_events(ARRAY(SELECT event_id FROM new_rows));
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM note_fact_events(ARRAY(SELECT event_id FROM old_rows));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER allocations_insert_facts AFTER INSERT ON allocations
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_member_events();
CREATE TRIGGER allocations_update_facts AFTER UPDATE ON allocations
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_member_events();
CREATE TRIGGER allocations_delete_facts AFTER DELETE ON allocations
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION note_member_events();
CREATE TRIGGER event_postings_insert_facts AFTER INSERT ON event_postings
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_member_events();
CREATE TRIGGER event_postings_update_facts AFTER UPDATE ON event_postings
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_member_events();
CREATE TRIGGER event_postings_delete_facts AFTER DELETE ON event_postings
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION note_member_events();

-- A credit link changes the facts of both events it joins. An allocation deleted with
-- its link is noted by the allocation trigger.
CREATE FUNCTION note_credit_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM note_fact_events(ARRAY(SELECT a.event_id FROM new_rows l JOIN allocations a
      ON a.id IN (l.credit_allocation_id, l.cost_allocation_id)));
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM note_fact_events(ARRAY(SELECT a.event_id FROM old_rows l JOIN allocations a
      ON a.id IN (l.credit_allocation_id, l.cost_allocation_id)));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER credit_links_insert_facts AFTER INSERT ON credit_links
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_credit_events();
CREATE TRIGGER credit_links_update_facts AFTER UPDATE ON credit_links
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_credit_events();
CREATE TRIGGER credit_links_delete_facts AFTER DELETE ON credit_links
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION note_credit_events();

-- Facts read a counterparty's kind and source.
CREATE FUNCTION note_counterparty_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM note_fact_events(ARRAY(
    SELECT e.id FROM new_rows n JOIN old_rows o ON o.id = n.id JOIN events e ON e.counterparty_id = n.id
    WHERE (n.kind, n.source) IS DISTINCT FROM (o.kind, o.source)));
  RETURN NULL;
END $$;
CREATE TRIGGER counterparties_update_facts AFTER UPDATE ON counterparties
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_counterparty_events();

-- Facts carry each allocation's top-level category.
CREATE FUNCTION note_category_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM note_fact_events(ARRAY(
    WITH RECURSIVE moved AS (
      SELECT n.id FROM new_rows n JOIN old_rows o ON o.id = n.id WHERE n.parent_id IS DISTINCT FROM o.parent_id
      UNION ALL SELECT c.id FROM categories c JOIN moved m ON c.parent_id = m.id)
    SELECT a.event_id FROM allocations a JOIN moved m ON m.id = a.category_id));
  RETURN NULL;
END $$;
CREATE TRIGGER categories_update_facts AFTER UPDATE ON categories
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_category_events();

-- A reviewed correction can rewrite a posting after its event is interpreted.
CREATE FUNCTION note_posting_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM note_fact_events(ARRAY(
    SELECT ep.event_id FROM new_rows n JOIN old_rows o ON o.id = n.id JOIN event_postings ep ON ep.posting_id = n.id
    WHERE (n.posted_on, n.value_on, n.account_id, n.currency, n.amount_minor)
      IS DISTINCT FROM (o.posted_on, o.value_on, o.account_id, o.currency, o.amount_minor)));
  RETURN NULL;
END $$;
CREATE TRIGGER postings_update_facts AFTER UPDATE ON postings
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_posting_events();
