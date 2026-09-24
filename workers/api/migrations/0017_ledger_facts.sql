-- What each allocation contributes to each measure, rewritten by the command that
-- changes it. Analysis reads only this table.
CREATE TABLE ledger_facts (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  allocation_id UUID,
  account_id UUID NOT NULL REFERENCES accounts(id),
  counterparty_id UUID REFERENCES counterparties(id) ON DELETE SET NULL,
  category_id UUID REFERENCES categories(id),
  top_category_id UUID REFERENCES categories(id),
  measure TEXT NOT NULL CHECK (measure IN (
    'spending', 'income', 'internal', 'externalOut', 'externalIn',
    'loanRepayment', 'borrowing', 'unresolvedOut', 'unresolvedIn')),
  posted_on DATE NOT NULL,
  spending_on DATE NOT NULL,
  currency TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  purchase BOOLEAN NOT NULL,
  model_assigned BOOLEAN NOT NULL
);
CREATE INDEX ledger_facts_spending ON ledger_facts (currency, measure, spending_on);
CREATE INDEX ledger_facts_posted ON ledger_facts (currency, measure, posted_on);
CREATE INDEX ledger_facts_event ON ledger_facts (event_id);

-- Any change that can alter an event's facts marks the event stale. Commands refresh
-- stale events before they commit, so the projection cannot drift from its source.
ALTER TABLE events ADD COLUMN facts_stale BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX events_facts_stale ON events (id) WHERE facts_stale;

CREATE FUNCTION mark_event_facts_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.facts_stale = OLD.facts_stale AND (to_jsonb(NEW) - 'facts_stale') IS DISTINCT FROM (to_jsonb(OLD) - 'facts_stale') THEN
    NEW.facts_stale := true;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER events_facts_stale BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION mark_event_facts_stale();

CREATE FUNCTION mark_allocation_event_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE events SET facts_stale = true WHERE id IN (
    SELECT (CASE WHEN TG_OP = 'DELETE' THEN OLD.event_id ELSE NEW.event_id END)
    UNION SELECT OLD.event_id WHERE TG_OP = 'UPDATE') AND NOT facts_stale;
  RETURN NULL;
END $$;
CREATE TRIGGER allocations_facts_stale AFTER INSERT OR UPDATE OR DELETE ON allocations
  FOR EACH ROW EXECUTE FUNCTION mark_allocation_event_stale();

CREATE FUNCTION mark_credit_events_stale() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE link credit_links;
BEGIN
  link := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  UPDATE events SET facts_stale = true WHERE NOT facts_stale AND id IN (
    SELECT event_id FROM allocations WHERE id IN (link.credit_allocation_id, link.cost_allocation_id));
  RETURN NULL;
END $$;
CREATE TRIGGER credit_links_facts_stale AFTER INSERT OR UPDATE OR DELETE ON credit_links
  FOR EACH ROW EXECUTE FUNCTION mark_credit_events_stale();

CREATE FUNCTION mark_counterparty_events_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.source IS DISTINCT FROM OLD.source THEN
    UPDATE events SET facts_stale = true WHERE counterparty_id = NEW.id AND NOT facts_stale;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER counterparties_facts_stale AFTER UPDATE ON counterparties
  FOR EACH ROW EXECUTE FUNCTION mark_counterparty_events_stale();

CREATE FUNCTION mark_category_events_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    UPDATE events SET facts_stale = true WHERE NOT facts_stale AND id IN (
      SELECT a.event_id FROM allocations a WHERE a.category_id IN (
        WITH RECURSIVE tree AS (SELECT NEW.id AS id UNION ALL SELECT c.id FROM categories c JOIN tree ON c.parent_id = tree.id)
        SELECT id FROM tree));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER categories_facts_stale AFTER UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION mark_category_events_stale();
