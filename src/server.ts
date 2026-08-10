import "dotenv/config";
import { Pool } from "pg";
import { AmoCrmChatsClient } from "./amocrm/chats-client.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logging.js";
import { InMemoryMappingStore } from "./storage/mapping-store.js";
import { PostgresMappingStore } from "./storage/postgres-store.js";
import { MessageRouter } from "./router/message-router.js";
import { WhatsAppAdapter } from "./adapters/whatsapp-adapter.js";
import { MaxAdapter } from "./adapters/max-adapter.js";
import { buildWebhookServer } from "./webhooks/server.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

if (!config.AMOCRM_CHATS_CHANNEL_ID || !config.AMOCRM_CHATS_CHANNEL_SECRET || !config.AMOCRM_CHATS_SCOPE_ID || !config.AMOCRM_CHATS_WEBHOOK_SECRET) {
  throw new Error("amoCRM Chats credentials are required to run the webhook bridge; obtain them from amoCRM support");
}

const store = config.DATABASE_URL ? new PostgresMappingStore(new Pool({ connectionString: config.DATABASE_URL })) : new InMemoryMappingStore();
const chats = new AmoCrmChatsClient({
  baseUrl: config.AMOCRM_CHATS_BASE_URL,
  channelId: config.AMOCRM_CHATS_CHANNEL_ID,
  channelSecret: config.AMOCRM_CHATS_CHANNEL_SECRET,
  readOnly: config.AMOCRM_READ_ONLY,
});

const whatsapp = config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID && config.WHATSAPP_GRAPH_API_VERSION
  ? new WhatsAppAdapter({ accessToken: config.WHATSAPP_ACCESS_TOKEN, phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID, graphVersion: config.WHATSAPP_GRAPH_API_VERSION, appSecret: config.WHATSAPP_APP_SECRET })
  : undefined;
const max = config.MAX_BOT_TOKEN ? new MaxAdapter({ token: config.MAX_BOT_TOKEN }) : undefined;
const adapters = [whatsapp, max].filter((value): value is NonNullable<typeof value> => Boolean(value));
const router = new MessageRouter({ store, chats, adapters, scopeForAccount: () => config.AMOCRM_CHATS_SCOPE_ID! });
const app = buildWebhookServer({
  router, amoWebhookSecret: config.AMOCRM_CHATS_WEBHOOK_SECRET,
  whatsapp, whatsappVerifyToken: config.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  max, maxAccountId: "default", maxWebhookSecret: config.MAX_WEBHOOK_SECRET,
  logger,
});

await app.listen({ port: config.PORT, host: "0.0.0.0" });
