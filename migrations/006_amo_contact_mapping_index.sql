CREATE INDEX IF NOT EXISTS conversation_mappings_amo_contact_account_idx
  ON conversation_mappings(messenger, messenger_account_id, amo_contact_id)
  WHERE amo_contact_id IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES (6) ON CONFLICT DO NOTHING;
