import type { MessageDirection, MessageStatus, MessengerKind, NormalizedMessage } from "../domain/messages.js";

export interface ConversationMapping {
  messenger: MessengerKind;
  messengerAccountId: string;
  messengerConversationId: string;
  amoConversationId?: string;
  amoContactId?: number;
  amoLeadId?: number;
  amoScopeId: string;
}

export interface MessageMapping {
  messenger: MessengerKind;
  messengerAccountId: string;
  messengerMessageId: string;
  messengerConversationId: string;
  amoMessageId?: string;
  amoConversationId?: string;
  direction: MessageDirection;
  status: MessageStatus;
  occurredAt: Date;
}

export interface MappingStore {
  reserveEvent(provider: string, externalEventId: string, payloadHash: string): Promise<boolean>;
  completeEvent(provider: string, externalEventId: string): Promise<void>;
  failEvent(provider: string, externalEventId: string, error: string): Promise<void>;
  getConversation(messenger: MessengerKind, accountId: string, conversationId: string): Promise<ConversationMapping | undefined>;
  findConversationByAmoId(amoConversationId: string): Promise<ConversationMapping | undefined>;
  upsertConversation(mapping: ConversationMapping): Promise<void>;
  saveMessage(mapping: MessageMapping): Promise<void>;
  findMessageByAmoId(amoMessageId: string): Promise<MessageMapping | undefined>;
  findMessageByMessengerId(messenger: MessengerKind, accountId: string, externalMessageId: string): Promise<MessageMapping | undefined>;
  updateMessageStatus(messenger: MessengerKind, accountId: string, externalMessageId: string, status: MessageStatus): Promise<void>;
}

export class InMemoryMappingStore implements MappingStore {
  private events = new Map<string, "processing" | "complete" | "failed">();
  private conversations: ConversationMapping[] = [];
  private messages: MessageMapping[] = [];
  async reserveEvent(provider: string, id: string): Promise<boolean> { const key = `${provider}:${id}`; const state = this.events.get(key); if (state && state !== "failed") return false; this.events.set(key, "processing"); return true; }
  async completeEvent(provider: string, id: string): Promise<void> { this.events.set(`${provider}:${id}`, "complete"); }
  async failEvent(provider: string, id: string): Promise<void> { this.events.set(`${provider}:${id}`, "failed"); }
  async getConversation(messenger: MessengerKind, accountId: string, conversationId: string): Promise<ConversationMapping | undefined> { return this.conversations.find(x => x.messenger === messenger && x.messengerAccountId === accountId && x.messengerConversationId === conversationId); }
  async findConversationByAmoId(id: string): Promise<ConversationMapping | undefined> { return this.conversations.find(x => x.amoConversationId === id); }
  async upsertConversation(mapping: ConversationMapping): Promise<void> { const old = await this.getConversation(mapping.messenger, mapping.messengerAccountId, mapping.messengerConversationId); if (old) Object.assign(old, mapping); else this.conversations.push({ ...mapping }); }
  async saveMessage(mapping: MessageMapping): Promise<void> { const old = this.messages.find(x => x.messenger === mapping.messenger && x.messengerAccountId === mapping.messengerAccountId && x.messengerMessageId === mapping.messengerMessageId); if (old) Object.assign(old, mapping); else this.messages.push({ ...mapping }); }
  async findMessageByAmoId(id: string): Promise<MessageMapping | undefined> { return this.messages.find(x => x.amoMessageId === id); }
  async findMessageByMessengerId(messenger: MessengerKind, accountId: string, id: string): Promise<MessageMapping | undefined> { return this.messages.find(x => x.messenger === messenger && x.messengerAccountId === accountId && x.messengerMessageId === id); }
  async updateMessageStatus(messenger: MessengerKind, accountId: string, id: string, status: MessageStatus): Promise<void> { const m = await this.findMessageByMessengerId(messenger, accountId, id); if (m && (status === "failed" || statusRank(status) >= statusRank(m.status))) m.status = status; }
}

function statusRank(status: MessageStatus): number { return ({ queued: 0, sent: 1, delivered: 2, read: 3, failed: -1 })[status]; }
