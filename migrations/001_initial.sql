CREATE TABLE IF NOT EXISTS messenger_accounts (
  id text PRIMARY KEY,
  messenger text NOT NULL CHECK (messenger IN ('telegram','whatsapp','max')),
  external_account_id text NOT NULL,
  amo_scope_id text,
  display_name text,
  credential_ref text NOT NULL,
  state text NOT NULL DEFAULT 'disconnected',
  last_connected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(messenger, external_account_id)
);

CREATE TABLE IF NOT EXISTS conversation_mappings (
  id bigserial PRIMARY KEY,
  messenger text NOT NULL CHECK (messenger IN ('telegram','whatsapp','max')),
  messenger_account_id text NOT NULL,
  messenger_conversation_id text NOT NULL,
  amo_conversation_id text,
  amo_contact_id bigint,
  amo_lead_id bigint,
  amo_scope_id text NOT NULL,
  last_sequence bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(messenger, messenger_account_id, messenger_conversation_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_mappings_amo_uidx ON conversation_mappings(amo_conversation_id) WHERE amo_conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_mappings (
  id bigserial PRIMARY KEY,
  messenger text NOT NULL CHECK (messenger IN ('telegram','whatsapp','max')),
  messenger_account_id text NOT NULL,
  messenger_message_id text NOT NULL,
  messenger_conversation_id text NOT NULL,
  amo_message_id text,
  amo_conversation_id text,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  status text NOT NULL CHECK (status IN ('queued','sent','delivered','read','failed')),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(messenger, messenger_account_id, messenger_message_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS message_mappings_amo_uidx ON message_mappings(amo_message_id) WHERE amo_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS webhook_events (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  external_event_id text NOT NULL,
  payload_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('processing','complete','failed')),
  attempts integer NOT NULL DEFAULT 1,
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(provider, external_event_id)
);
