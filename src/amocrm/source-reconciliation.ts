import type { MessengerAccount, AccountRepository } from "../domain/accounts.js";

export interface AmoSource {
  id: number;
  name: string;
  external_id: string;
  origin_code?: string | null;
}

export interface AmoSourcesClient {
  getSources(limit?: number): Promise<unknown>;
  createSources(sources: Array<{ name: string; external_id: string; origin_code: string }>): Promise<unknown>;
}

export interface SourceVerification {
  displayName: string;
  messengerAccountId: string;
  sourceExternalId: string;
  amoSourceId?: number;
  sourceName?: string;
}

export function sourceExternalIdForAccount(accountId: string): string {
  const compact = accountId.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(compact)) throw new Error("messenger account ID must be a UUID to generate amoCRM source external_id");
  return `tg-${compact}`;
}

export class AmoSourceReconciliationService {
  constructor(private readonly accounts: AccountRepository, private readonly sources: AmoSourcesClient, private readonly originCode: string) {}

  async reconcile(): Promise<SourceVerification[]> {
    const accounts = (await this.accounts.listAll()).filter((account) => account.messenger === "telegram");
    for (const account of accounts) await this.ensureExternalId(account);
    const refreshed = (await this.accounts.listAll()).filter((account) => account.messenger === "telegram");
    const existing = await this.listSources();
    const externalIds = new Set(existing.map((source) => source.external_id));
    const missing = refreshed.filter((account) => !externalIds.has(account.sourceExternalId));
    for (const batch of chunks(missing, 50)) {
      await this.sources.createSources(batch.map((account) => ({ name: sourceName(account), external_id: account.sourceExternalId, origin_code: this.originCode })));
    }
    const finalSources = missing.length ? await this.listSources() : existing;
    return sourceVerification(refreshed, finalSources);
  }

  async verify(): Promise<SourceVerification[]> {
    return sourceVerification((await this.accounts.listAll()).filter((account) => account.messenger === "telegram"), await this.listSources());
  }

  private async ensureExternalId(account: MessengerAccount): Promise<void> {
    const desired = sourceExternalIdForAccount(account.id);
    if (account.sourceExternalId === desired) return;
    if (account.sourceExternalId && account.sourceExternalId !== "telegram-main") {
      throw new Error(`Telegram account ${account.id} has unsupported source_external_id; refusing to replace it automatically`);
    }
    await this.accounts.upsert({ ...account, sourceExternalId: desired });
  }

  private async listSources(): Promise<AmoSource[]> {
    const response: any = await this.sources.getSources(100);
    const values = response?._embedded?.sources;
    if (!Array.isArray(values)) return [];
    return values.filter(validSource);
  }
}

function sourceVerification(accounts: MessengerAccount[], sources: AmoSource[]): SourceVerification[] {
  const byExternalId = new Map(sources.map((source) => [source.external_id, source]));
  return accounts.map((account) => {
    const source = byExternalId.get(account.sourceExternalId);
    return { displayName: sourceName(account), messengerAccountId: account.id, sourceExternalId: account.sourceExternalId, ...(source ? { amoSourceId: source.id, sourceName: source.name } : {}) };
  });
}

function sourceName(account: MessengerAccount): string { return account.displayName?.trim() || `Telegram ${account.providerAccountId}`; }
function validSource(value: any): value is AmoSource { return Number.isInteger(value?.id) && typeof value?.name === "string" && typeof value?.external_id === "string"; }
function chunks<T>(values: T[], size: number): T[][] { return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size)); }
