import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../src/storage/migrations.js";
import { PostgresJobQueue } from "../src/queue/postgres-job-queue.js";
import { PostgresAccountRepository } from "../src/storage/account-repository.js";
import { EncryptedPostgresSecretStore } from "../src/security/secret-store.js";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("PostgreSQL production storage", () => {
  const pool = new Pool({ connectionString: url });
  beforeAll(async () => { await migrate(pool); await pool.query("TRUNCATE jobs, message_mappings, conversation_mappings, messenger_accounts, secrets CASCADE"); });
  afterAll(async () => { await pool.end(); });

  it("persists encrypted secrets and isolated accounts", async () => {
    const secrets = new EncryptedPostgresSecretStore(pool, "integration-master-key-that-is-long-enough");
    await secrets.put("telegram:one", { session: "highly-sensitive-session" });
    expect(await secrets.get("telegram:one")).toEqual({ session: "highly-sensitive-session" });
    const raw = await pool.query("SELECT ciphertext FROM secrets WHERE id='telegram:one'");
    expect(raw.rows[0].ciphertext).not.toContain("highly-sensitive-session");

    const accounts = new PostgresAccountRepository(pool);
    await secrets.put("telegram:two", { session: "second-session" });
    await accounts.upsert({ id:"one", messenger:"telegram", providerAccountId:"101", credentialRef:"telegram:one", amoAccountId:"amo-test", sourceExternalId:"src-one", config:{}, state:"connected" });
    await accounts.upsert({ id:"two", messenger:"telegram", providerAccountId:"202", credentialRef:"telegram:two", amoAccountId:"amo-test", sourceExternalId:"src-two", config:{}, state:"connected" });
    expect((await accounts.findByProvider("telegram", "202"))?.id).toBe("two");
  });

  it("deduplicates, orders partitions, and recovers a crashed lease", async () => {
    const queue = new PostgresJobQueue(pool);
    const first = await queue.enqueue({ kind:"messenger.inbound", partitionKey:"chat-A", dedupeKey:"event-1", payload:{ text:"one" } });
    expect((await queue.enqueue({ kind:"messenger.inbound", partitionKey:"chat-A", dedupeKey:"event-1", payload:{ text:"one" } })).inserted).toBe(false);
    await queue.enqueue({ kind:"messenger.inbound", partitionKey:"chat-A", dedupeKey:"event-2", payload:{ text:"two" } });
    const claimed = await queue.claim("crashed", 1);
    expect(claimed?.id).toBe(first.id);
    expect(await queue.claim("parallel", 1)).toBeUndefined();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(await queue.recoverStale(1)).toBe(1);
    const recovered = await queue.claim("restart", 1000);
    expect(recovered?.dedupeKey).toBe("event-1");
    await queue.complete(recovered!.id, "restart");
    expect((await queue.claim("restart", 1000))?.dedupeKey).toBe("event-2");
  });
});
