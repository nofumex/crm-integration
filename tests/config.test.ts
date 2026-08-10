import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const valid = {
  AMOCRM_BASE_URL:"https://example.amocrm.ru", AMOCRM_ACCESS_TOKEN:"token", AMOCRM_CHATS_CHANNEL_ID:"channel", AMOCRM_CHATS_CHANNEL_SECRET:"12345678901234567890",
  DATABASE_URL:"postgres://db", SECRET_MASTER_KEY:"12345678901234567890123456789012", ADMIN_API_TOKEN:"12345678901234567890123456789012",
  S3_REGION:"eu-1", S3_BUCKET:"bucket", S3_ACCESS_KEY_ID:"key", S3_SECRET_ACCESS_KEY:"secret", CLAMAV_HOST:"localhost",
};
describe("startup safety validation",()=>{
  it("defaults amoCRM to production/read-only",()=>{const c=loadConfig(valid as any);expect(c.AMOCRM_READ_ONLY).toBe(true);expect(c.AMOCRM_ENVIRONMENT).toBe("production");});
  it("physically refuses write-enabled production configuration",()=>{expect(()=>loadConfig({...valid,AMOCRM_READ_ONLY:"false",AMOCRM_ENVIRONMENT:"production"} as any)).toThrow("amoCRM writes require");});
  it("permits writes only when explicitly marked test",()=>{expect(loadConfig({...valid,AMOCRM_READ_ONLY:"false",AMOCRM_ENVIRONMENT:"test"} as any).AMOCRM_READ_ONLY).toBe(false);});
});
