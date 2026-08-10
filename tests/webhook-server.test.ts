import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildWebhookServer } from "../src/webhooks/server.js";

describe("webhook authentication", () => {
  it("rejects an invalid amoCRM signature before routing", async () => {
    const routeAmoOutbound = vi.fn();
    const app = buildWebhookServer({ router: { routeAmoOutbound } as any, amoWebhookSecret: "secret" });
    const response = await app.inject({ method: "POST", url: "/webhooks/amocrm/scope", headers: { "content-type": "application/json", "x-signature": "invalid" }, payload: { message: {} } });
    expect(response.statusCode).toBe(401);
    expect(routeAmoOutbound).not.toHaveBeenCalled();
    await app.close();
  }, 15_000);

  it("routes an amoCRM webhook signed over exact raw bytes", async () => {
    const routeAmoOutbound = vi.fn(async () => undefined);
    const app = buildWebhookServer({ router: { routeAmoOutbound } as any, amoWebhookSecret: "secret" });
    const raw = '{"message":{"message":{"id":"m1"}}}';
    const signature = createHmac("sha1", "secret").update(raw).digest("hex");
    const response = await app.inject({ method: "POST", url: "/webhooks/amocrm/scope", headers: { "content-type": "application/json", "x-signature": signature }, payload: raw });
    expect(response.statusCode).toBe(200);
    expect(routeAmoOutbound).toHaveBeenCalledOnce();
    await app.close();
  });

  it("validates WhatsApp verification token", async () => {
    const app = buildWebhookServer({ router: {} as any, amoWebhookSecret: "secret", whatsappVerifyToken: "verify-me" });
    const response = await app.inject({ method: "GET", url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("12345");
    await app.close();
  });
});
