import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const valid = {
  AMOCRM_BASE_URL:"https://example.amocrm.ru", AMOCRM_ACCESS_TOKEN:"token",
  DATABASE_URL:"postgres://db", SECRET_MASTER_KEY:"12345678901234567890123456789012", ADMIN_API_TOKEN:"12345678901234567890123456789012",
  AMOCRM_DEFAULT_SOURCE_EXTERNAL_ID:"telegram-main", TELEGRAM_API_ID:"12345", TELEGRAM_API_HASH:"telegram-hash", S3_REGION:"eu-1", S3_BUCKET:"bucket", S3_ACCESS_KEY_ID:"key", S3_SECRET_ACCESS_KEY:"secret", CLAMAV_HOST:"localhost",
};
describe("startup safety validation",()=>{
  it("defaults amoCRM to production/read-only",()=>{const c=loadConfig(valid as any);expect(c.AMOCRM_READ_ONLY).toBe(true);expect(c.AMOCRM_ENVIRONMENT).toBe("production");});
  it("starts without amoCRM Chats channel credentials for initial deployment",()=>{const c=loadConfig(valid as any);expect(c.AMOCRM_CHATS_CHANNEL_ID).toBeUndefined();expect(c.AMOCRM_CHATS_CHANNEL_SECRET).toBeUndefined();});
  it("accepts configured amoCRM Chats channel credentials",()=>{const c=loadConfig({...valid,AMOCRM_CHATS_CHANNEL_ID:"channel",AMOCRM_CHATS_CHANNEL_SECRET:"12345678901234567890"} as any);expect(c.AMOCRM_CHATS_CHANNEL_ID).toBe("channel");});
  it("refuses write mode without explicit enable and expected target",()=>{expect(()=>loadConfig({...valid,AMOCRM_READ_ONLY:"false"} as any)).toThrow("WRITES_ENABLED");});
  it("permits future production writes only with explicit gate and target identity",()=>{const c=loadConfig({...valid,AMOCRM_READ_ONLY:"false",AMOCRM_WRITES_ENABLED:"true",AMOCRM_EXPECTED_ACCOUNT_ID:"123",AMOCRM_EXPECTED_SUBDOMAIN:"expected"} as any);expect(c.AMOCRM_WRITES_ENABLED).toBe(true);expect(c.AMOCRM_ENVIRONMENT).toBe("production");});
  it("permits a first OAuth authorization before tokens exist",()=>{const c=loadConfig({...valid,AMOCRM_ACCESS_TOKEN:"",AMOCRM_INTEGRATION_ID:"id",AMOCRM_CLIENT_SECRET:"secret",AMOCRM_REDIRECT_URI:"https://sinaichannel.ru/oauth/callback"} as any);expect(c.AMOCRM_ACCESS_TOKEN).toBeUndefined();expect(c.AMOCRM_INTEGRATION_ID).toBe("id");});
});
