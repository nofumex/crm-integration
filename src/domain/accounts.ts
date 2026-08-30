import type { MessengerKind } from "./messages.js";

export type AccountState = "disconnected" | "connecting" | "connected" | "reconnect_required" | "disabled" | "error";

export interface MessengerAccount {
  id: string;
  messenger: MessengerKind;
  providerAccountId: string;
  displayName?: string;
  credentialRef: string;
  amoAccountId: string;
  amoScopeId?: string;
  sourceExternalId: string;
  config: Record<string, unknown>;
  state: AccountState;
  lastError?: string;
}

export interface AccountRepository {
  get(id: string): Promise<MessengerAccount | undefined>;
  findByProvider(messenger: MessengerKind, providerAccountId: string): Promise<MessengerAccount | undefined>;
  findByScope(scopeId: string): Promise<MessengerAccount | undefined>;
  findByScopeAndSource(scopeId: string, sourceExternalId: string): Promise<MessengerAccount | undefined>;
  listEnabled(): Promise<MessengerAccount[]>;
  listAll(): Promise<MessengerAccount[]>;
  upsert(account: MessengerAccount): Promise<void>;
  /** Removes the account and all database-owned account data atomically. */
  delete(id: string): Promise<boolean>;
  setScope(id: string, scopeId: string): Promise<void>;
  setState(id: string, state: AccountState, error?: string): Promise<void>;
}
