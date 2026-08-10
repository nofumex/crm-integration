CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS secrets (
  id text PRIMARY KEY,
  ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messenger_accounts (
  id text PRIMARY KEY,
  messenger text NOT NULL CHECK (messenger IN ('telegram','whatsapp','max')),
  provider_account_id text NOT NULL,
  display_name text,
  credential_ref text NOT NULL REFERENCES secrets(id),
  amo_account_id text NOT NULL,
  amo_scope_id text,
  source_external_id text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'disconnected' CHECK (state IN ('disconnected','connecting','connected','reconnect_required','disabled','error')),
  last_error text,
  last_connected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(messenger, provider_account_id, amo_account_id),
  UNIQUE(amo_account_id, source_external_id)
);

CREATE TABLE IF NOT EXISTS conversation_mappings (
  id bigserial PRIMARY KEY,
  messenger text NOT NULL CHECK (messenger IN ('telegram','whatsapp','max')),
  messenger_account_id text NOT NULL REFERENCES messenger_accounts(id),
  provider_conversation_id text,
  provider_recipient_id text NOT NULL,
  amo_conversation_id text,
  amo_contact_id bigint,
  amo_lead_id bigint,
  amo_scope_id text NOT NULL,
  write_first_state text NOT NULL DEFAULT 'none' CHECK (write_first_state IN ('none','pending','linked','failed')),
  last_inbound_at timestamptz,
  last_sequence bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(messenger, messenger_account_id, provider_recipient_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_mappings_provider_conversation_uidx
  ON conversation_mappings(messenger, messenger_account_id, provider_conversation_id)
  WHERE provider_conversation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conversation_mappings_amo_uidx
  ON conversation_mappings(amo_conversation_id) WHERE amo_conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_mappings (
  id bigserial PRIMARY KEY,
  messenger text NOT NULL CHECK (messenger IN ('telegram','whatsapp','max')),
  messenger_account_id text NOT NULL REFERENCES messenger_accounts(id),
  messenger_message_id text NOT NULL,
  provider_conversation_id text NOT NULL,
  amo_message_id text,
  amo_conversation_id text,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  status text NOT NULL CHECK (status IN ('queued','sent','delivered','read','failed')),
  status_at timestamptz NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(messenger, messenger_account_id, messenger_message_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS message_mappings_amo_uidx ON message_mappings(amo_message_id) WHERE amo_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS jobs (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  partition_key text NOT NULL,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','completed','dead')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 12,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kind, dedupe_key)
);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs(state, available_at, id);
CREATE INDEX IF NOT EXISTS jobs_partition_idx ON jobs(partition_key, id);

INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
