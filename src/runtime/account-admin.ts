import type { AccountRepository, MessengerAccount } from "../domain/accounts.js";
import type { ReconnectSupervisor } from "./adapter-runtime.js";
import type { TelegramOnboardingService } from "./telegram-onboarding.js";
import type { TelegramCodeDelivery } from "../adapters/telegram-adapter.js";

export interface AdminAccountView {
  id: string;
  messenger: string;
  phone: string;
  displayName?: string;
  amoAccountId: string;
  amoScopeId?: string;
  sourceExternalId: string;
  state: string;
  lastError?: string;
  onboardingStatus: null | "awaiting_code" | "awaiting_password";
  codeDelivery?: TelegramCodeDelivery;
}

export class AccountAdminService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly supervisor: ReconnectSupervisor,
    private readonly onboarding?: TelegramOnboardingService,
  ) {}

  async list(): Promise<AdminAccountView[]> {
    const rows = await this.accounts.listAll();
    return rows.map((a) => toView(a, this.onboarding?.getStatus(a.id) ?? null, this.onboarding?.getDelivery(a.id)));
  }

  async disconnect(accountId: string): Promise<{ ok: true }> {
    await this.supervisor.disconnectAccount(accountId);
    return { ok: true };
  }

  async reconnect(accountId: string): Promise<{ ok: true; state: string }> {
    await this.supervisor.reconnectAccount(accountId);
    const account = await this.accounts.get(accountId);
    return { ok: true, state: account?.state ?? "connecting" };
  }
}

function toView(account: MessengerAccount, onboardingStatus: AdminAccountView["onboardingStatus"], codeDelivery?: TelegramCodeDelivery): AdminAccountView {
  return {
    id: account.id,
    messenger: account.messenger,
    phone: String(account.config.phone ?? account.providerAccountId),
    displayName: account.displayName,
    amoAccountId: account.amoAccountId,
    amoScopeId: account.amoScopeId,
    sourceExternalId: account.sourceExternalId,
    state: account.state,
    lastError: account.lastError,
    onboardingStatus,
    ...(codeDelivery ? { codeDelivery } : {}),
  };
}
