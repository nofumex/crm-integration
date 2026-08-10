import { describe, expect, it, vi } from "vitest";
import { TelegramAdapter } from "../src/adapters/telegram-adapter.js";

describe("Telegram MTProto adapter", () => {
  it("connects an encrypted-session client, receives messages and uses resolved provider IDs", async () => {
    let eventHandler: ((event: unknown) => Promise<void>) | undefined;
    const fake = {
      connected: true,
      session: { save: () => "new-session" },
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      isUserAuthorized: vi.fn(async () => true),
      addEventHandler: vi.fn((handler: typeof eventHandler) => { eventHandler = handler; }),
      getEntity: vi.fn(async () => ({ id: 77123 })),
      sendMessage: vi.fn(async () => ({ id: 55, date: 1_700_000_000 })),
      sendFile: vi.fn(),
      downloadMedia: vi.fn(),
      start: vi.fn(),
    };
    const adapter = new TelegramAdapter({ accountId: "tg-1", apiId: 1, apiHash: "hash", session: "ciphertext-loaded-by-secret-store", client: fake as any });
    const inbound = vi.fn(async () => undefined);
    adapter.onInbound(inbound);
    await adapter.connect("tg-1");
    expect(await adapter.resolveRecipient({ username: "client" })).toEqual({ providerRecipientId: "77123", providerConversationId: "77123" });
    await adapter.send({ accountId: "tg-1", conversationId: "77123", recipientId: "77123", text: "hello", idempotencyKey: "amo-1" });
    expect(fake.sendMessage).toHaveBeenCalledWith("77123", { message: "hello" });
    await eventHandler?.({ message: { id: 8, out: false, chatId: 77123, senderId: 99, message: "incoming", date: 1_700_000_001 } });
    expect(inbound).toHaveBeenCalledWith(expect.objectContaining({ accountId: "tg-1", conversationId: "77123", id: "8" }));
  });
});
