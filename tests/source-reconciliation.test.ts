import { describe, expect, it, vi } from "vitest";
import { AmoSourceReconciliationService, sourceExternalIdForAccount } from "../src/amocrm/source-reconciliation.js";
import { InMemoryAccountRepository } from "../src/storage/account-repository.js";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";

describe("amoCRM source reconciliation", () => {
  it("generates a stable amoCRM-safe ID from an account UUID", () => {
    expect(sourceExternalIdForAccount(first)).toBe("tg-11111111111141118111111111111111");
    expect(sourceExternalIdForAccount(first)).toHaveLength(35);
  });

  it("replaces legacy source IDs, creates missing sources once, and reports safe verification data", async () => {
    const accounts = new InMemoryAccountRepository();
    await accounts.upsert(account(first, "Тест Тест", "telegram-main"));
    await accounts.upsert(account(second, "Тест 2", ""));
    const sources: any[] = [];
    const client = { getSources: vi.fn(async () => ({ _embedded: { sources } })), createSources: vi.fn(async (values: any[]) => { for (const value of values) sources.push({ id: sources.length + 100, ...value }); return { _embedded: { sources: values } }; }) };
    const service = new AmoSourceReconciliationService(accounts, client, "amo.ext.17354872");
    const result = await service.reconcile();
    expect(client.createSources).toHaveBeenCalledOnce();
    expect(client.createSources).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: "Тест Тест", external_id: sourceExternalIdForAccount(first), origin_code: "amo.ext.17354872" }),
      expect.objectContaining({ name: "Тест 2", external_id: sourceExternalIdForAccount(second), origin_code: "amo.ext.17354872" }),
    ]));
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: "Тест Тест", messengerAccountId: first, sourceExternalId: sourceExternalIdForAccount(first), amoSourceId: 100, sourceName: "Тест Тест" }),
      expect.objectContaining({ displayName: "Тест 2", messengerAccountId: second, sourceExternalId: sourceExternalIdForAccount(second), amoSourceId: 101, sourceName: "Тест 2" }),
    ]));
    await service.reconcile();
    expect(client.createSources).toHaveBeenCalledOnce();
  });
});

function account(id: string, displayName: string, sourceExternalId: string) { return { id, messenger: "telegram" as const, providerAccountId: id, displayName, credentialRef: `telegram:${id}`, amoAccountId: "17354872", sourceExternalId, config: {}, state: "connected" as const }; }
