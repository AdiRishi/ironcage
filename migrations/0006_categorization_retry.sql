-- verify: SELECT EXISTS (
--   SELECT 1 FROM capability_configs
--    WHERE capability = 'money.categorization' AND version = 2
-- )

ALTER TABLE capability_dispatches
  ADD COLUMN restart_requested boolean NOT NULL DEFAULT false;

INSERT INTO capability_configs (capability, version, model, enabled, created_at)
VALUES (
  'money.categorization',
  2,
  'cloudflare/openai/gpt-5.6-luna',
  true,
  now()
);
