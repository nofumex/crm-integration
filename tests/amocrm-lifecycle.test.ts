import { describe, expect, it, vi } from "vitest";
import { AmoChatsLifecycle } from "../src/amocrm/lifecycle.js";
import { InMemoryAccountRepository } from "../src/storage/account-repository.js";

describe("amoCRM Chats lifecycle",()=>{
  it("uses amojo_id for /connect and persists the returned scope_id",async()=>{
    const accounts=new InMemoryAccountRepository();
    await accounts.upsert({id:"wa-1",messenger:"whatsapp",providerAccountId:"phone-id",credentialRef:"secret",amoAccountId:"123",sourceExternalId:"source-wa",config:{},state:"disconnected"});
    const rest={getAccountWithAmojoId:vi.fn(async()=>({id:123,amojo_id:"amojo-account"})),findSources:vi.fn(async()=>({_embedded:{sources:[]}})),createSources:vi.fn(async()=>({}))};
    const chats={connectChannel:vi.fn(async()=>({scope_id:"scope-returned"}))};
    const lifecycle=new AmoChatsLifecycle(rest as any,chats as any,accounts);
    expect(await lifecycle.connectAccount("wa-1","Number one")).toBe("scope-returned");
    expect(chats.connectChannel).toHaveBeenCalledWith("amojo-account","Number one");
    expect((await accounts.get("wa-1"))?.amoScopeId).toBe("scope-returned");
    await lifecycle.ensureSource("wa-1",42);
    expect(rest.createSources).toHaveBeenCalledWith([expect.objectContaining({external_id:"source-wa",pipeline_id:42,services:[{type:"whatsapp",params:{waba:true}}]})]);
  });
});
