import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { WhatsAppAdapter } from "../src/adapters/whatsapp-adapter.js";

describe("WhatsAppAdapter", () => {
  it("sends through the official Graph /messages endpoint", async () => {
    const transport = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }));
    const adapter = new WhatsAppAdapter({ accountId:"wa-1",accessToken: "token", phoneNumberId: "phone-id", graphVersion: "v99.0", transport });
    const result = await adapter.send({ accountId: "phone-id", conversationId: "7900", recipientId: "7900", text: "hello", idempotencyKey: "amo-1" });
    expect(result.externalMessageId).toBe("wamid.1");
    expect(transport.mock.calls[0]?.[0]).toBe("https://graph.facebook.com/v99.0/phone-id/messages");
  });

  it("verifies Meta sha256 raw-body signature", () => {
    const adapter = new WhatsAppAdapter({ accountId:"wa-1",accessToken: "token", phoneNumberId: "id", graphVersion: "v99.0", appSecret: "app-secret" });
    const raw = '{"object":"whatsapp_business_account"}';
    const signature = `sha256=${createHmac("sha256", "app-secret").update(raw).digest("hex")}`;
    expect(adapter.verifyWebhook(raw, signature)).toBe(true);
    expect(adapter.verifyWebhook(`${raw} `, signature)).toBe(false);
  });

  it("sends an approved template and maps inbound media/status webhooks", async () => {
    const transport=vi.fn(async(_url:string|URL|Request,_init?:RequestInit)=>new Response(JSON.stringify({messages:[{id:"wamid.template"}]}),{status:200}));
    const adapter=new WhatsAppAdapter({accountId:"wa-1",accessToken:"token",phoneNumberId:"phone-id",graphVersion:"v99.0",transport});
    await adapter.send({accountId:"wa-1",conversationId:"7999",recipientId:"7999",idempotencyKey:"m",template:{name:"order_update",languageCode:"ru"}});
    const sentBody=JSON.parse(String(((transport.mock.calls as unknown as Array<[string,RequestInit]>)[0]![1]).body));
    expect(sentBody).toMatchObject({to:"7999",type:"template",template:{name:"order_update",language:{code:"ru"}}});
    const inbound=vi.fn(async()=>undefined);const status=vi.fn(async()=>undefined);adapter.onInbound(inbound);adapter.onStatus(status);
    await adapter.acceptWebhook({entry:[{changes:[{value:{metadata:{phone_number_id:"phone-id"},contacts:[{profile:{name:"Client"}}],messages:[{id:"in-1",from:"7999",timestamp:"1700000000",text:{body:"hi"}}],statuses:[{id:"wamid.template",recipient_id:"7999",timestamp:"1700000001",status:"read"}]}}]}]});
    expect(inbound).toHaveBeenCalledWith(expect.objectContaining({accountId:"wa-1",conversationId:"7999",text:"hi"}));
    expect(status).toHaveBeenCalledWith("wa-1","wamid.template","read",new Date(1700000001000));
  });
});
