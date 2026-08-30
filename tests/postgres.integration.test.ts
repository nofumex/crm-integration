import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../src/storage/migrations.js";
import { PostgresJobQueue } from "../src/queue/postgres-job-queue.js";
import { PostgresAccountRepository } from "../src/storage/account-repository.js";
import { EncryptedPostgresSecretStore } from "../src/security/secret-store.js";
import { PostgresDeliveryReconciliationStore } from "../src/storage/delivery-reconciliation.js";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("PostgreSQL production storage", () => {
  const pool = new Pool({ connectionString: url });
  beforeAll(async () => { await migrate(pool);expect(Number((await pool.query("SELECT max(version) version FROM schema_migrations")).rows[0].version)).toBe(6);await pool.query("TRUNCATE jobs, message_mappings, conversation_mappings, messenger_accounts, secrets CASCADE"); });
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

  it("atomically removes an account, mappings, credential, and Telegram peer secrets", async () => {
    const secrets = new EncryptedPostgresSecretStore(pool, "integration-master-key-that-is-long-enough");
    const accounts = new PostgresAccountRepository(pool);
    await secrets.put("telegram:delete", { session: "session" });
    await secrets.put("telegram-peer:delete:peer-1", { kind:"telegram_input_peer_user", userId:"peer-1", accessHash:"hash" });
    await secrets.put("telegram-peer:delete:peer-2", { kind:"telegram_input_peer_user", userId:"peer-2", accessHash:"hash" });
    await accounts.upsert({ id:"delete", messenger:"telegram", providerAccountId:"303", credentialRef:"telegram:delete", amoAccountId:"amo-test", sourceExternalId:"src-delete", config:{}, state:"disconnected" });
    await pool.query("INSERT INTO conversation_mappings(messenger,messenger_account_id,provider_conversation_id,provider_recipient_id,amo_scope_id) VALUES('telegram','delete','peer-1','peer-1','scope')");
    await pool.query("INSERT INTO message_mappings(messenger,messenger_account_id,messenger_message_id,provider_conversation_id,direction,status,status_at,occurred_at) VALUES('telegram','delete','message-1','peer-1','inbound','sent',now(),now())");
    expect(await accounts.delete("delete")).toBe(true);
    expect(await accounts.get("delete")).toBeUndefined();
    expect((await pool.query("SELECT 1 FROM conversation_mappings WHERE messenger_account_id='delete'")).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM message_mappings WHERE messenger_account_id='delete'")).rowCount).toBe(0);
    expect(await secrets.get("telegram:delete")).toBeUndefined();
    expect(await secrets.get("telegram-peer:delete:peer-1")).toBeUndefined();
    expect(await secrets.get("telegram-peer:delete:peer-2")).toBeUndefined();
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
    const second=await queue.claim("restart", 1000);expect(second?.dedupeKey).toBe("event-2");await queue.complete(second!.id,"restart");
  });

  it("scrubs completed payloads and deletes expired jobs",async()=>{const queue=new PostgresJobQueue(pool);const job=await queue.enqueue({kind:"messenger.inbound",partitionKey:"retention",dedupeKey:"retention",payload:{text:"must not live forever"}});const claimed=await queue.claim("retention-worker",1000);await queue.complete(claimed!.id,"retention-worker");await pool.query("UPDATE jobs SET updated_at=now()-interval '40 days' WHERE id=$1",[job.id]);const cutoff=new Date(Date.now()-30*86400000);const result=await queue.cleanup({payloadBefore:cutoff,completedBefore:cutoff,deadBefore:new Date(Date.now()-90*86400000)});expect(result.payloadsPruned).toBe(1);expect(result.jobsDeleted).toBe(1);});

  it("retains dead payload and atomically clears delivery_unknown while requeueing",async()=>{const queue=new PostgresJobQueue(pool);const inserted=await queue.enqueue({kind:"amocrm.outbound",partitionKey:"amo:scope:conversation",dedupeKey:"atomic-reconcile",payload:{scopeId:"scope",body:{message:{message:{id:"amo-unknown-atomic"}}}}});const claimed=await queue.claim("unknown-worker",1000);await queue.deadLetter(claimed!.id,"unknown-worker","DeliveryUnknownError: provider outcome is ambiguous");await pool.query("INSERT INTO message_mappings(messenger,messenger_account_id,messenger_message_id,provider_conversation_id,amo_message_id,direction,status,status_at,occurred_at) VALUES('telegram','one','delivery-unknown:amo-unknown-atomic','provider-chat','amo-unknown-atomic','outbound','delivery_unknown',now(),now())");await pool.query("UPDATE jobs SET updated_at=now()-interval '40 days' WHERE id=$1",[inserted.id]);await queue.cleanup({payloadBefore:new Date(),completedBefore:new Date(Date.now()-30*86400000),deadBefore:new Date(Date.now()-90*86400000)});expect((await pool.query("SELECT payload FROM jobs WHERE id=$1",[inserted.id])).rows[0].payload.body.message.message.id).toBe("amo-unknown-atomic");const reconciliation=new PostgresDeliveryReconciliationStore(pool);expect(await reconciliation.confirmNotAccepted("different-message",inserted.id)).toBe(false);expect((await pool.query("SELECT state FROM jobs WHERE id=$1",[inserted.id])).rows[0].state).toBe("dead");expect(await reconciliation.confirmNotAccepted("amo-unknown-atomic",inserted.id)).toBe(true);expect((await pool.query("SELECT count(*)::int n FROM message_mappings WHERE amo_message_id='amo-unknown-atomic'")).rows[0].n).toBe(0);expect((await pool.query("SELECT state,last_error FROM jobs WHERE id=$1",[inserted.id])).rows[0]).toMatchObject({state:"pending",last_error:null});});
});
