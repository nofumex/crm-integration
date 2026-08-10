import { describe, expect, it, vi } from "vitest";
import { MessageRouter } from "../src/router/message-router.js";
import { InMemoryMappingStore } from "../src/storage/mapping-store.js";
import type { NormalizedMessage } from "../src/domain/messages.js";

describe("MessageRouter idempotency", () => {
  it("does not create a duplicate amoCRM message for a repeated inbound event", async () => {
    const store = new InMemoryMappingStore();
    const sendMessage = vi.fn(async () => ({ new_message: { conversation_id: "amo-conv", msgid: "amo-msg" } }));
    const router = new MessageRouter({ store, chats: { sendMessage } as any, adapters: [], scopeForAccount: () => "scope" });
    const message: NormalizedMessage = { id: "tg-42", messenger: "telegram", accountId: "tg-account", conversationId: "tg-chat", direction: "inbound", sender: { externalId: "customer" }, text: "hello", attachments: [], occurredAt: new Date("2026-08-10T10:00:00Z"), status: "delivered" };
    await router.routeInbound(message);
    await router.routeInbound(message);
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("allows provider retry after a failed attempt", async () => {
    const store = new InMemoryMappingStore();
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockRejectedValueOnce(new Error("temporary"))
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue({ new_message: { conversation_id: "amo-conv", msgid: "amo-msg" } });
    const router = new MessageRouter({ store, chats: { sendMessage } as any, adapters: [], scopeForAccount: () => "scope" });
    const message: NormalizedMessage = { id: "wa-1", messenger: "whatsapp", accountId: "wa-account", conversationId: "7900", direction: "inbound", sender: { externalId: "7900" }, text: "hello", attachments: [], occurredAt: new Date(), status: "delivered" };
    await expect(router.routeInbound(message)).rejects.toThrow("temporary");
    await expect(router.routeInbound(message)).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(4); // three internal attempts, then webhook retry
  });

  it("does not downgrade an out-of-order delivery status", async () => {
    const store = new InMemoryMappingStore();
    await store.saveMessage({ messenger: "whatsapp", messengerAccountId: "wa", messengerMessageId: "wamid", messengerConversationId: "7900", direction: "outbound", status: "sent", occurredAt: new Date() });
    await store.updateMessageStatus("whatsapp", "wa", "wamid", "read");
    await store.updateMessageStatus("whatsapp", "wa", "wamid", "delivered");
    expect((await store.findMessageByMessengerId("whatsapp", "wa", "wamid"))?.status).toBe("read");
  });
});
