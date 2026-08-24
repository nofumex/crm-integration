import { describe, expect, it, vi } from "vitest";
import { AmoChatsLifecycle } from "../src/amocrm/lifecycle.js";
import { InMemoryAccountRepository } from "../src/storage/account-repository.js";

describe("amoCRM Chats lifecycle",()=>{
  it("uses amojo_id for /connect and persists the returned scope_id",async()=>{
    const accounts=new InMemoryAccountRepository();
    await accounts.upsert({id:"tg-1",messenger:"telegram",providerAccountId:"user-id",credentialRef:"secret",amoAccountId:"123",sourceExternalId:"source-tg",config:{},state:"disconnected"});
    const rest={getAccountWithAmojoId:vi.fn(async()=>({id:123,amojo_id:"amojo-account"})),createSources:vi.fn()};
    const chats={connectChannel:vi.fn(async()=>({scope_id:"scope-returned"}))};
    const lifecycle=new AmoChatsLifecycle(rest as any,chats as any,accounts);
    expect(await lifecycle.connectAccount("tg-1","Number one")).toBe("scope-returned");
    expect(chats.connectChannel).toHaveBeenCalledWith("amojo-account","Number one");
    expect((await accounts.get("tg-1"))?.amoScopeId).toBe("scope-returned");
    expect(rest.createSources).not.toHaveBeenCalled();
  });
});
