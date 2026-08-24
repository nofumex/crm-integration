ALTER TABLE conversation_mappings ADD COLUMN IF NOT EXISTS provider_recipient_ref jsonb;
ALTER TABLE conversation_mappings ADD COLUMN IF NOT EXISTS provider_profile jsonb;

INSERT INTO schema_migrations(version) VALUES (3) ON CONFLICT DO NOTHING;
