import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AmoCrmChatsClient, verifyAmoWebhookSignature } from "../src/amocrm/chats-client.js";

describe("amoCRM Chats signing", () => {
  it("uses documented method/md5/content-type/date/path HMAC input", async () => {
    const transport = vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const now = new Date("2026-08-10T10:00:00Z");
    const client = new AmoCrmChatsClient({ channelId: "channel", channelSecret: "topsecret", readOnly: false, transport, now: () => now });
    await client.sendMessage("scope", { hello: "world" });
    const [, init] = transport.mock.calls[0]!;
    const body = JSON.stringify({ hello: "world" });
    const md5 = createHash("md5").update(body).digest("hex");
    const path = "/v2/origin/custom/scope";
    const expected = createHmac("sha1", "topsecret").update(["POST", md5, "application/json", now.toUTCString(), path].join("\n")).digest("hex");
    expect(new Headers(init.headers).get("x-signature")).toBe(expected);
  });

  it("verifies webhook raw-body HMAC without leaking the secret", () => {
    const body = '{"message":{"message":{"id":"1"}}}';
    const signature = createHmac("sha1", "hook-secret").update(body).digest("hex");
    expect(verifyAmoWebhookSignature(body, signature, "hook-secret")).toBe(true);
    expect(verifyAmoWebhookSignature(body + " ", signature, "hook-secret")).toBe(false);
  });
});
