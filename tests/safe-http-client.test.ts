import { describe, expect, it, vi } from "vitest";
import { SafeHttpClient } from "../src/http/safe-http-client.js";
import { ReadOnlyViolationError } from "../src/core/errors.js";
import { AmoCrmRestClient } from "../src/amocrm/rest-client.js";
import { AmoCrmChatsClient } from "../src/amocrm/chats-client.js";
import { HttpError } from "../src/http/http-error.js";

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

  it("returns undefined for an empty successful HTTP 204 response",async()=>{const transport=vi.fn(async()=>new Response(null,{status:204}));const client=new SafeHttpClient({baseUrl:"https://production.amocrm.ru",transport});await expect(client.request("GET","/api/v4/account")).resolves.toBeUndefined();});
  it.each([200,202])("returns undefined for an empty successful HTTP %i response",async(status)=>{const transport=vi.fn(async()=>new Response("",{status}));const client=new SafeHttpClient({baseUrl:"https://production.amocrm.ru",transport});await expect(client.request("GET","/api/v4/account")).resolves.toBeUndefined();});
  it("parses a non-empty successful JSON response",async()=>{const transport=vi.fn(async()=>new Response(JSON.stringify({ok:true}),{status:200}));const client=new SafeHttpClient({baseUrl:"https://production.amocrm.ru",transport});await expect(client.request("GET","/api/v4/account")).resolves.toEqual({ok:true});});

  it.each([400,401,403,422])("keeps safe amoCRM error diagnostics for HTTP %i",async(status)=>{const transport=vi.fn(async()=>new Response(JSON.stringify({title:"validation failed",access_token:"must-not-log"}),{status,headers:{"content-type":"application/problem+json"}}));const client=new SafeHttpClient({baseUrl:"https://production.amocrm.ru",readOnly:false,transport});let error:HttpError|undefined;try{await client.request("POST","/api/v4/contacts/chats",{body:"[]"});}catch(value){error=value as HttpError;}expect(error).toMatchObject({status,responseContentType:"application/problem+json",safeMessage:`HTTP request failed with status ${status}`});expect(error?.responseBody).toContain("validation failed");expect(error?.responseBody).not.toContain("must-not-log");});

  it("REST write helper cannot bypass the guard", async () => {
    const transport = vi.fn();
    const client = new AmoCrmRestClient({ baseUrl: "https://production.amocrm.ru", accessToken: "secret", transport });
    await expect(client.linkChatToContact(1, "chat")).rejects.toBeInstanceOf(ReadOnlyViolationError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("uses the custom-field filter and safely falls back when amoCRM rejects its alpha filter",async()=>{const transport=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({title:"filter unavailable"}),{status:400})).mockResolvedValueOnce(new Response(JSON.stringify({_embedded:{contacts:[]}}),{status:200}));const client=new AmoCrmRestClient({baseUrl:"https://production.amocrm.ru",accessToken:"secret",transport});await expect(client.findContactsByCustomField(603408,"7727079839")).resolves.toEqual({_embedded:{contacts:[]}});expect(transport.mock.calls[0]![0]).toContain("filter[custom_fields_values][603408][]=7727079839");expect(transport.mock.calls[1]![0]).toContain("query=7727079839");});

  it("logs only safe amoCRM response diagnostics for contact chat link failures",async()=>{const logger={error:vi.fn()};const transport=vi.fn(async()=>new Response(JSON.stringify({detail:"chat cannot be linked",client_secret:"must-not-log"}),{status:400,headers:{"content-type":"application/json"}}));const client=new AmoCrmRestClient({baseUrl:"https://production.amocrm.ru",accessToken:"secret",readOnly:false,transport,logger});await expect(client.linkChatToContact(1,"chat")).rejects.toMatchObject({status:400,responseContentType:"application/json"});expect(logger.error).toHaveBeenCalledWith({status:400,endpoint:"/api/v4/contacts/chats",responseBody:expect.stringContaining("chat cannot be linked")},"amoCRM contact chat linking failed");expect(JSON.stringify(logger.error.mock.calls)).not.toContain("must-not-log");expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret\"");});

  it("blocks REST writes before even asking a refresh-capable token provider",async()=>{const tokenProvider={getAccessToken:vi.fn(async()=>"token")};const client=new AmoCrmRestClient({baseUrl:"https://production.amocrm.ru",tokenProvider});await expect(client.patchContact(1,{})).rejects.toBeInstanceOf(ReadOnlyViolationError);expect(tokenProvider.getAccessToken).not.toHaveBeenCalled();});

  it("Chats API write helper cannot bypass the same guard", async () => {
    const transport = vi.fn();
    const client = new AmoCrmChatsClient({ channelId: "channel", channelSecret: "secret", transport });
    await expect(client.sendMessage("scope", { event_type: "new_message" })).rejects.toBeInstanceOf(ReadOnlyViolationError);
    expect(transport).not.toHaveBeenCalled();
  });
});
