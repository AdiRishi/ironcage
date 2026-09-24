-- A reviewed correction can rewrite a posting after its event is interpreted, so the
-- event's facts are marked stale like any other change they read.
CREATE FUNCTION mark_posting_events_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.posted_on, NEW.value_on, NEW.account_id, NEW.currency, NEW.amount_minor)
    IS DISTINCT FROM (OLD.posted_on, OLD.value_on, OLD.account_id, OLD.currency, OLD.amount_minor) THEN
    UPDATE events SET facts_stale = true WHERE NOT facts_stale AND id IN (
      SELECT event_id FROM event_postings WHERE posting_id = NEW.id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER postings_facts_stale AFTER UPDATE ON postings
  FOR EACH ROW EXECUTE FUNCTION mark_posting_events_stale();
