import { describe, expect, it, vi } from "vitest";
import { AmoChatsLifecycle } from "../src/amocrm/lifecycle.js";
import { InMemoryAccountRepository } from "../src/storage/account-repository.js";

describe("amoCRM Chats lifecycle",()=>{
  it("uses amojo_id for /connect and persists the returned scope_id",async()=>{
    const accounts=new InMemoryAccountRepository();
    await accounts.upsert({id:"tg-1",messenger:"telegram",providerAccountId:"user-id",credentialRef:"secret",amoAccountId:"123",sourceExternalId:"source-tg",config:{},state:"disconnected"});
    const rest={getAccountWithAmojoId:vi.fn(async()=>({id:123,amojo_id:"amojo-account"})),createSources:vi.fn()};
    const chats={connectChannel:vi.fn(async()=>({account_id:"amojo-account",scope_id:"scope-returned",title:"Number one",hook_api_version:"v2",is_time_window_disabled:true}))};
    const logger={warn:vi.fn()};const lifecycle=new AmoChatsLifecycle(rest as any,chats as any,accounts,logger);
    await accounts.upsert({id:"tg-2",messenger:"telegram",providerAccountId:"user-id-2",credentialRef:"secret-2",amoAccountId:"123",amoScopeId:"scope-returned",sourceExternalId:"source-tg",config:{},state:"connected"});
    expect(await lifecycle.connectAccount("tg-1","Number one")).toEqual({scopeId:"scope-returned",connectResponse:{account_id:"amojo-account",scope_id:"scope-returned",title:"Number one",hook_api_version:"v2",is_time_window_disabled:true},sharedScopeAccountIds:["tg-2"]});
    expect(chats.connectChannel).toHaveBeenCalledWith("amojo-account","Number one");
    expect((await accounts.get("tg-1"))?.amoScopeId).toBe("scope-returned");
    expect(rest.createSources).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({accountId:"tg-1",scopeId:"scope-returned",sharedScopeAccountIds:["tg-2"]},expect.stringContaining("scope is shared"));
  });
});
