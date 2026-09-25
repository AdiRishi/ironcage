-- Counterparty identification and the analyst each have a switch, and one usage warning
-- covers the recorded usage of every task that calls a model. The analyst sends the
-- model figures and bank descriptions, so it stays off until you turn it on.
ALTER TABLE enrichment_settings RENAME TO model_settings;
ALTER TABLE model_settings RENAME CONSTRAINT enrichment_settings_pkey TO model_settings_pkey;
ALTER TABLE model_settings RENAME CONSTRAINT enrichment_settings_id_check TO model_settings_id_check;
ALTER TABLE model_settings RENAME CONSTRAINT enrichment_settings_warning_minor_check TO model_settings_warning_minor_check;
ALTER TABLE model_settings RENAME CONSTRAINT enrichment_settings_auto_apply_confidence_check TO model_settings_auto_apply_confidence_check;
ALTER TABLE model_settings RENAME COLUMN enabled TO enrichment_enabled;
ALTER TABLE model_settings ADD COLUMN analyst_enabled BOOLEAN NOT NULL DEFAULT false;
