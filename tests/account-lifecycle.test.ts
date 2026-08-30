import { describe, expect, it, vi } from "vitest";
import { InMemoryAccountRepository } from "../src/storage/account-repository.js";
import { InMemoryAdapterRegistry, type MessengerAdapter } from "../src/adapters/messenger-adapter.js";
import { ReconnectSupervisor } from "../src/runtime/adapter-runtime.js";
import { TelegramOnboardingService } from "../src/runtime/telegram-onboarding.js";
import { InMemorySecretStore } from "../src/security/secret-store.js";
import { AccountAdminService } from "../src/runtime/account-admin.js";

function adapter(id:string, disconnect=vi.fn(async()=>undefined)):MessengerAdapter { return { kind:"telegram", accountId:id, connect:vi.fn(async()=>undefined), disconnect, send:vi.fn(), onInbound:vi.fn(), onStatus:vi.fn(), health:vi.fn(async()=>({connected:false})), resolveRecipient:vi.fn() }; }
function deferred<T>(){let resolve!: (value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}

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

  it("disconnect cancels an awaiting-code onboarding",async()=>{
    const accounts=new InMemoryAccountRepository(),secrets=new InMemorySecretStore(),pendingDisconnect=vi.fn(async()=>undefined),supervisor={disconnectAccount:vi.fn(async()=>undefined)} as any;
    await accounts.upsert({id:"a1",messenger:"telegram",providerAccountId:"p",credentialRef:"telegram:a1",amoAccountId:"amo",sourceExternalId:"src",config:{},state:"connecting"}); await secrets.put("telegram:a1",{session:""});
    const onboarding=new TelegramOnboardingService(secrets,accounts,{apiId:1,apiHash:"h"},()=>({beginAuthorization:vi.fn(async()=>({method:"app" as const,canResend:false})),submitAuthorizationCode:vi.fn(),submitAuthorizationPassword:vi.fn(),resendAuthorizationCode:vi.fn(),authorizationSession:()=>"",disconnect:pendingDisconnect}));
    await onboarding.start({accountId:"a1",phone:"+1",amoAccountId:"amo"}); const admin=new AccountAdminService(accounts,supervisor,onboarding);
    await expect(admin.disconnect("a1")).resolves.toEqual({ok:true}); expect(onboarding.getStatus("a1")).toBeNull(); expect(pendingDisconnect).toHaveBeenCalledOnce(); expect(supervisor.disconnectAccount).toHaveBeenCalledWith("a1"); await expect(onboarding.submitCode("a1","12345")).rejects.toThrow("No active onboarding");
  });

  it("disconnect cancels an awaiting-password onboarding",async()=>{
    const accounts=new InMemoryAccountRepository(),secrets=new InMemorySecretStore(),pendingDisconnect=vi.fn(async()=>undefined),supervisor={disconnectAccount:vi.fn(async()=>undefined)} as any;
    await accounts.upsert({id:"a1",messenger:"telegram",providerAccountId:"p",credentialRef:"telegram:a1",amoAccountId:"amo",sourceExternalId:"src",config:{},state:"connecting"}); await secrets.put("telegram:a1",{session:""});
    const onboarding=new TelegramOnboardingService(secrets,accounts,{apiId:1,apiHash:"h"},()=>({beginAuthorization:vi.fn(async()=>({method:"app" as const,canResend:false})),submitAuthorizationCode:vi.fn(async()=>"awaiting_password" as const),submitAuthorizationPassword:vi.fn(),resendAuthorizationCode:vi.fn(),authorizationSession:()=>"",disconnect:pendingDisconnect}));
    await onboarding.start({accountId:"a1",phone:"+1",amoAccountId:"amo"}); await onboarding.submitCode("a1","12345"); const admin=new AccountAdminService(accounts,supervisor,onboarding);
    await expect(admin.disconnect("a1")).resolves.toEqual({ok:true}); expect(onboarding.getStatus("a1")).toBeNull(); expect(pendingDisconnect).toHaveBeenCalledOnce(); await expect(onboarding.submitPassword("a1","password")).rejects.toThrow("No active onboarding");
  });

  it("serializes delete behind an in-flight authorization and leaves no secrets behind",async()=>{
    const accounts=new InMemoryAccountRepository(), secrets=new InMemorySecretStore(), code=deferred<"completed"|"awaiting_password">();
    await accounts.upsert({id:"a1",messenger:"telegram",providerAccountId:"p",credentialRef:"telegram:a1",amoAccountId:"amo",sourceExternalId:"src",config:{},state:"connecting"}); await secrets.put("telegram:a1",{session:"old"}); await secrets.put("telegram-peer:a1:p",{accessHash:"hash"});
    const onboarding=new TelegramOnboardingService(secrets,accounts,{apiId:1,apiHash:"h"},()=>({beginAuthorization:vi.fn(async()=>({method:"app" as const,canResend:false})),submitAuthorizationCode:vi.fn(()=>code.promise),submitAuthorizationPassword:vi.fn(),resendAuthorizationCode:vi.fn(),authorizationSession:()=>"new",disconnect:vi.fn(async()=>undefined)}));
    await onboarding.start({accountId:"a1",phone:"+1",amoAccountId:"amo"});
    const baseDelete=accounts.delete.bind(accounts); accounts.delete=async id=>{const removed=await baseDelete(id);await secrets.delete("telegram:a1");await secrets.delete("telegram-peer:a1:p");return removed;};
    const admin=new AccountAdminService(accounts,{disconnectAccount:vi.fn(async()=>undefined)} as any,onboarding);
    const submitting=onboarding.submitCode("a1","12345"), deleting=admin.delete("a1"); let deleted=false;void deleting.then(()=>{deleted=true;}); await Promise.resolve(); expect(deleted).toBe(false);
    code.resolve("completed"); await submitting; await deleting;
    expect(await accounts.get("a1")).toBeUndefined(); expect(await secrets.get("telegram:a1")).toBeUndefined(); expect(await secrets.get("telegram-peer:a1:p")).toBeUndefined(); expect(onboarding.getStatus("a1")).toBeNull();
  });

  it("serializes delete behind an in-flight 2FA completion",async()=>{
    const accounts=new InMemoryAccountRepository(), secrets=new InMemorySecretStore(), password=deferred<void>();
    await accounts.upsert({id:"a1",messenger:"telegram",providerAccountId:"p",credentialRef:"telegram:a1",amoAccountId:"amo",sourceExternalId:"src",config:{},state:"connecting"}); await secrets.put("telegram:a1",{session:"old"});
    const onboarding=new TelegramOnboardingService(secrets,accounts,{apiId:1,apiHash:"h"},()=>({beginAuthorization:vi.fn(async()=>({method:"app" as const,canResend:false})),submitAuthorizationCode:vi.fn(async()=>"awaiting_password" as const),submitAuthorizationPassword:vi.fn(()=>password.promise),resendAuthorizationCode:vi.fn(),authorizationSession:()=>"new",disconnect:vi.fn(async()=>undefined)}));
    await onboarding.start({accountId:"a1",phone:"+1",amoAccountId:"amo"}); await onboarding.submitCode("a1","12345");
    const baseDelete=accounts.delete.bind(accounts); accounts.delete=async id=>{const removed=await baseDelete(id);await secrets.delete("telegram:a1");return removed;};
    const admin=new AccountAdminService(accounts,{disconnectAccount:vi.fn(async()=>undefined)} as any,onboarding);
    const submitting=onboarding.submitPassword("a1","password"), deleting=admin.delete("a1"); password.resolve(); await submitting; await deleting;
    expect(await accounts.get("a1")).toBeUndefined(); expect(await secrets.get("telegram:a1")).toBeUndefined(); expect(onboarding.getStatus("a1")).toBeNull();
  });
});
