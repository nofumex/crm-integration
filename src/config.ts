import { z } from "zod";

const boolDefaultTrue = z.string().optional().transform(v => v === undefined ? true : !["false", "0", "no"].includes(v.toLowerCase()));
const schema = z.object({
  AMOCRM_BASE_URL: z.string().url(),
  AMOCRM_ACCESS_TOKEN: z.string().min(1),
  AMOCRM_READ_ONLY: boolDefaultTrue,
  AMOCRM_CHATS_BASE_URL: z.string().url().default("https://amojo.amocrm.ru"),
  AMOCRM_CHATS_CHANNEL_ID: z.string().optional(),
  AMOCRM_CHATS_CHANNEL_SECRET: z.string().optional(),
  AMOCRM_CHATS_SCOPE_ID: z.string().optional(),
  AMOCRM_CHATS_WEBHOOK_SECRET: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default("info"),
  WHATSAPP_GRAPH_API_VERSION: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  MAX_BOT_TOKEN: z.string().optional(),
  MAX_WEBHOOK_SECRET: z.string().optional(),
});

export type AppConfig = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig { return schema.parse(env); }
