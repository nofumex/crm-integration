import { describe, expect, it, vi } from "vitest";
import { InMemoryAccountRepository } from "../src/storage/account-repository.js";
import { InMemoryAdapterRegistry, type MessengerAdapter } from "../src/adapters/messenger-adapter.js";
import { ReconnectSupervisor } from "../src/runtime/adapter-runtime.js";
import { TelegramOnboardingService } from "../src/runtime/telegram-onboarding.js";
import { InMemorySecretStore } from "../src/security/secret-store.js";
import { AccountAdminService } from "../src/runtime/account-admin.js";

function adapter(id:string, disconnect=vi.fn(async()=>undefined)):MessengerAdapter { return { kind:"telegram", accountId:id, connect:vi.fn(async()=>undefined), disconnect, send:vi.fn(), onInbound:vi.fn(), onStatus:vi.fn(), health:vi.fn(async()=>({connected:false})), resolveRecipient:vi.fn() }; }

describe("account lifecycle",()=>{
  it("keeps a disconnected account stopped across supervisor cycles and reconnects only explicitly",async()=>{
    const accounts=new InMemoryAccountRepository(); await accounts.upsert({id:"a1",messenger:"telegram",providerAccountId:"p",credentialRef:"telegram:a1",amoAccountId:"amo",sourceExternalId:"src",config:{},state:"connected"});
    const registry=new InMemoryAdapterRegistry(), live=adapter("a1"); registry.register(live);
    const created=adapter("a1"), factory={create:vi.fn(async()=>created)} as any;
    const supervisor=new ReconnectSupervisor(accounts,registry,factory);
    await supervisor.disconnectAccount("a1"); await supervisor.reconcile(); await supervisor.reconcile();
    expect(await accounts.get("a1")).toMatchObject({state:"disconnected"}); expect(live.disconnect).toHaveBeenCalledOnce(); expect(registry.get("telegram","a1")).toBeUndefined(); expect(factory.create).not.toHaveBeenCalled();
    await supervisor.reconnectAccount("a1"); expect(factory.create).toHaveBeenCalledOnce(); expect(created.connect).toHaveBeenCalledWith("a1"); expect(await accounts.get("a1")).toMatchObject({state:"connected"});
    await accounts.delete("a1"); await expect(supervisor.disconnectAccount("a1")).rejects.toThrow("Unknown account"); await expect(supervisor.reconnectAccount("a1")).rejects.toThrow("Unknown account");
  });

  it("deletes an account after stopping it and cancelling pending Telegram onboarding",async()=>{
    const accounts=new InMemoryAccountRepository(), secrets=new InMemorySecretStore(); await accounts.upsert({id:"a1",messenger:"telegram",providerAccountId:"p",credentialRef:"telegram:a1",amoAccountId:"amo",sourceExternalId:"src",config:{},state:"connecting"}); await secrets.put("telegram:a1",{session:""});
    const pendingDisconnect=vi.fn(async()=>undefined); const onboarding=new TelegramOnboardingService(secrets,accounts,{apiId:1,apiHash:"h"},()=>({beginAuthorization:vi.fn(async()=>({method:"app" as const,canResend:false})),submitAuthorizationCode:vi.fn(),submitAuthorizationPassword:vi.fn(),resendAuthorizationCode:vi.fn(),authorizationSession:()=>"",disconnect:pendingDisconnect}));
    await onboarding.start({accountId:"a1",phone:"+1",amoAccountId:"amo"});
    const supervisor={disconnectAccount:vi.fn(async()=>undefined)} as any; const admin=new AccountAdminService(accounts,supervisor,onboarding);
    await expect(admin.delete("a1")).resolves.toEqual({ok:true}); expect(pendingDisconnect).toHaveBeenCalledOnce(); expect(await accounts.get("a1")).toBeUndefined(); await expect(admin.delete("a1")).rejects.toThrow("Unknown account");
  });
});
