ALTER TABLE conversation_mappings ADD COLUMN IF NOT EXISTS provider_recipient_secret_ref text;

INSERT INTO schema_migrations(version) VALUES (4) ON CONFLICT DO NOTHING;
