import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { WhatsAppAdapter } from "../src/adapters/whatsapp-adapter.js";

describe("WhatsAppAdapter", () => {
  it("sends through the official Graph /messages endpoint", async () => {
    const transport = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }));
    const adapter = new WhatsAppAdapter({ accessToken: "token", phoneNumberId: "phone-id", graphVersion: "v99.0", transport });
    const result = await adapter.send({ accountId: "phone-id", conversationId: "7900", recipientId: "7900", text: "hello", idempotencyKey: "amo-1" });
    expect(result.externalMessageId).toBe("wamid.1");
    expect(transport.mock.calls[0]?.[0]).toBe("https://graph.facebook.com/v99.0/phone-id/messages");
  });

  it("verifies Meta sha256 raw-body signature", () => {
    const adapter = new WhatsAppAdapter({ accessToken: "token", phoneNumberId: "id", graphVersion: "v99.0", appSecret: "app-secret" });
    const raw = '{"object":"whatsapp_business_account"}';
    const signature = `sha256=${createHmac("sha256", "app-secret").update(raw).digest("hex")}`;
    expect(adapter.verifyWebhook(raw, signature)).toBe(true);
    expect(adapter.verifyWebhook(`${raw} `, signature)).toBe(false);
  });
});
