ALTER TABLE messenger_accounts DROP CONSTRAINT IF EXISTS messenger_accounts_amo_account_id_source_external_id_key;

INSERT INTO schema_migrations(version) VALUES (5) ON CONFLICT DO NOTHING;
