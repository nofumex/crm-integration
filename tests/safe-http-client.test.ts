import { describe, expect, it, vi } from "vitest";
import { SafeHttpClient } from "../src/http/safe-http-client.js";
import { ReadOnlyViolationError } from "../src/core/errors.js";
import { AmoCrmRestClient } from "../src/amocrm/rest-client.js";
import { AmoCrmChatsClient } from "../src/amocrm/chats-client.js";

describe("amoCRM read-only safety layer", () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    it(`blocks ${method} before invoking the transport`, async () => {
      const transport = vi.fn();
      const client = new SafeHttpClient({ baseUrl: "https://production.amocrm.ru", transport });
      await expect(client.request(method, "/api/v4/test", { body: "{}" })).rejects.toBeInstanceOf(ReadOnlyViolationError);
      expect(transport).not.toHaveBeenCalled();
    });
  }

  it("allows GET in default read-only mode", async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new SafeHttpClient({ baseUrl: "https://production.amocrm.ru", transport });
    await expect(client.request("GET", "/api/v4/account")).resolves.toEqual({ ok: true });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("REST write helper cannot bypass the guard", async () => {
    const transport = vi.fn();
    const client = new AmoCrmRestClient({ baseUrl: "https://production.amocrm.ru", accessToken: "secret", transport });
    await expect(client.linkChatToContact(1, "chat")).rejects.toBeInstanceOf(ReadOnlyViolationError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("Chats API write helper cannot bypass the same guard", async () => {
    const transport = vi.fn();
    const client = new AmoCrmChatsClient({ channelId: "channel", channelSecret: "secret", transport });
    await expect(client.sendMessage("scope", { event_type: "new_message" })).rejects.toBeInstanceOf(ReadOnlyViolationError);
    expect(transport).not.toHaveBeenCalled();
  });
});
