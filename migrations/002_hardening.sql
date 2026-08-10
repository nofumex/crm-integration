ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payload_pruned_at timestamptz;
CREATE INDEX IF NOT EXISTS jobs_retention_idx ON jobs(state, updated_at);
ALTER TABLE message_mappings DROP CONSTRAINT IF EXISTS message_mappings_status_check;
ALTER TABLE message_mappings ADD CONSTRAINT message_mappings_status_check CHECK (status IN ('queued','sent','delivered','read','failed','delivery_unknown'));
INSERT INTO schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING;
