import { createHash } from "node:crypto";
import type { AmoCrmChatsClient } from "../amocrm/chats-client.js";
import type { MessengerAdapter } from "../adapters/messenger-adapter.js";
import type { MessengerKind, NormalizedAttachment, NormalizedMessage, SendMessageCommand } from "../domain/messages.js";
import type { MappingStore } from "../storage/mapping-store.js";
import { KeyedSerialExecutor } from "../core/keyed-serial-executor.js";
import { withRetry } from "../core/retry.js";

interface RouterOptions {
  store: MappingStore;
  chats: AmoCrmChatsClient;
  adapters: MessengerAdapter[];
  scopeForAccount: (messenger: MessengerKind, accountId: string) => Promise<string> | string;
}

export class MessageRouter {
  private readonly adapters = new Map<MessengerKind, MessengerAdapter>();
  private readonly serial = new KeyedSerialExecutor();
  constructor(private readonly options: RouterOptions) {
    for (const adapter of options.adapters) {
      this.adapters.set(adapter.kind, adapter);
      adapter.onInbound(message => this.routeInbound(message));
      adapter.onStatus(async (accountId, id, status) => {
        const message = await this.options.store.findMessageByMessengerId(adapter.kind, accountId, id);
        await this.options.store.updateMessageStatus(adapter.kind, accountId, id, status);
        if (!message?.amoMessageId || status === "sent" || status === "queued") return;
        const conversation = message.amoConversationId ? await this.options.store.findConversationByAmoId(message.amoConversationId) : undefined;
        if (!conversation) return;
        await this.options.chats.updateDeliveryStatus(conversation.amoScopeId, message.amoMessageId, status === "read" ? { status_code: 2 } : status === "delivered" ? { status_code: 1 } : { status_code: -1, error_code: 905, error: "Messenger reported delivery failure" });
      });
    }
  }

  async routeInbound(message: NormalizedMessage): Promise<void> {
    const provider = `${message.messenger}:inbound`;
    const eventId = `${message.accountId}:${message.conversationId}:${message.id}`;
    const hash = sha256(JSON.stringify({ id: message.id, text: message.text, attachments: message.attachments }));
    if (!(await this.options.store.reserveEvent(provider, eventId, hash))) return;
    const key = `${message.messenger}:${message.accountId}:${message.conversationId}`;
    try {
      await this.serial.run(key, async () => {
        const scopeId = await this.options.scopeForAccount(message.messenger, message.accountId);
        const existing = await this.options.store.getConversation(message.messenger, message.accountId, message.conversationId);
        const parts = message.attachments.length ? message.attachments : [undefined];
        let amoConversationId = existing?.amoConversationId;
        for (let i = 0; i < parts.length; i++) {
          const externalMessageId = parts.length === 1 ? message.id : `${message.id}:${i}`;
          const response: any = await withRetry(() => this.options.chats.sendMessage(scopeId, amoPayload(message, externalMessageId, parts[i], amoConversationId)));
          amoConversationId = response?.new_message?.conversation_id ?? amoConversationId;
          await this.options.store.saveMessage({ messenger: message.messenger, messengerAccountId: message.accountId, messengerMessageId: externalMessageId, messengerConversationId: message.conversationId, amoMessageId: response?.new_message?.msgid, amoConversationId, direction: "inbound", status: "sent", occurredAt: message.occurredAt });
        }
        await this.options.store.upsertConversation({ messenger: message.messenger, messengerAccountId: message.accountId, messengerConversationId: message.conversationId, amoConversationId, amoContactId: existing?.amoContactId, amoLeadId: existing?.amoLeadId, amoScopeId: scopeId });
      });
      await this.options.store.completeEvent(provider, eventId);
    } catch (error) {
      await this.options.store.failEvent(provider, eventId, safeError(error));
      throw error;
    }
  }

  async routeAmoOutbound(hook: any): Promise<void> {
    const data = hook?.message ?? hook;
    const amoMessageId = String(data?.message?.id ?? "");
    const amoConversationId = String(data?.conversation?.id ?? "");
    if (!amoMessageId || !amoConversationId) throw new Error("Invalid amoCRM Chats v2 message webhook");
    const provider = "amocrm:outbound";
    if (!(await this.options.store.reserveEvent(provider, amoMessageId, sha256(JSON.stringify(hook))))) return;
    try {
      const mapping = await this.options.store.findConversationByAmoId(amoConversationId);
      if (!mapping) throw new Error(`No conversation mapping for amoCRM conversation ${amoConversationId}`);
      const adapter = this.adapters.get(mapping.messenger);
      if (!adapter) throw new Error(`No adapter registered for ${mapping.messenger}`);
      const command: SendMessageCommand = {
        accountId: mapping.messengerAccountId, conversationId: mapping.messengerConversationId,
        recipientId: String(data?.receiver?.id ?? mapping.messengerConversationId), text: data?.message?.text,
        attachments: amoWebhookAttachments(data?.message), idempotencyKey: amoMessageId,
      };
      const result = await this.serial.run(`${mapping.messenger}:${mapping.messengerAccountId}:${mapping.messengerConversationId}`, () => withRetry(() => adapter.send(command)));
      await this.options.store.saveMessage({ messenger: mapping.messenger, messengerAccountId: mapping.messengerAccountId, messengerMessageId: result.externalMessageId, messengerConversationId: mapping.messengerConversationId, amoMessageId, amoConversationId, direction: "outbound", status: result.status, occurredAt: result.occurredAt });
      if (result.status !== "sent" && result.status !== "queued") {
        await this.options.chats.updateDeliveryStatus(mapping.amoScopeId, amoMessageId, { status_code: result.status === "read" ? 2 : result.status === "delivered" ? 1 : -1, ...(result.status === "failed" ? { error_code: 905, error: "Messenger rejected the message" } : {}) });
      }
      await this.options.store.completeEvent(provider, amoMessageId);
    } catch (error) {
      await this.options.store.failEvent(provider, amoMessageId, safeError(error));
      throw error;
    }
  }
}

function amoPayload(message: NormalizedMessage, msgid: string, attachment: NormalizedAttachment | undefined, conversationRefId?: string): unknown {
  if (attachment && !attachment.url) throw new Error(`Attachment ${attachment.id ?? msgid} has no amoCRM-reachable media URL; configure MediaStore`);
  const type = attachment ? ({ image: "picture", video: "video", audio: "audio", voice: "voice", sticker: "sticker", file: "file", unknown: "file" } as const)[attachment.kind] : "text";
  return { event_type: "new_message", payload: {
    timestamp: Math.floor(message.occurredAt.getTime()/1000), msec_timestamp: message.occurredAt.getTime(), msgid,
    conversation_id: message.conversationId, ...(conversationRefId ? { conversation_ref_id: conversationRefId } : {}),
    sender: { id: message.sender.externalId, name: message.sender.displayName ?? message.sender.username ?? message.sender.externalId,
      ...(message.sender.avatarUrl ? { avatar: message.sender.avatarUrl } : {}),
      ...((message.sender.phone) ? { profile: { phone: message.sender.phone } } : {}) },
    message: { type, text: attachment?.caption ?? message.text ?? "", ...(attachment?.url ? { media: attachment.url } : {}), ...(attachment?.fileName ? { file_name: attachment.fileName } : {}), ...(attachment?.size ? { file_size: attachment.size } : {}) },
    silent: false,
  }};
}

function amoWebhookAttachments(message: any): NormalizedAttachment[] {
  if (!message?.media) return [];
  const kind = ({ picture: "image", video: "video", audio: "audio", voice: "voice", sticker: "sticker", file: "file" } as const)[message.type as "picture"] ?? "unknown";
  return [{ kind, url: message.media, fileName: message.file_name, size: message.file_size }];
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function safeError(error: unknown): string { return error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error"; }
