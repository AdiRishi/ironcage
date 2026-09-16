ALTER TABLE rule_applications ADD COLUMN applied_rules JSONB NOT NULL DEFAULT '[]';
UPDATE rule_applications a SET applied_rules = (
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) FROM rules r WHERE r.id=ANY(a.rule_ids)
);
ALTER TABLE rule_applications DROP COLUMN rule_ids;
