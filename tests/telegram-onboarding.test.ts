import { describe, expect, it, vi } from "vitest";
import { TelegramOnboardingService } from "../src/runtime/telegram-onboarding.js";
import { AdapterFactory } from "../src/runtime/adapter-runtime.js";
import { TelegramAdapter } from "../src/adapters/telegram-adapter.js";
import { InMemoryAccountRepository } from "../src/storage/account-repository.js";
import { InMemorySecretStore } from "../src/security/secret-store.js";
import { InMemoryJobQueue } from "../src/queue/in-memory-job-queue.js";

describe("Telegram onboarding recovery",()=>{
 it("reauthorizes an existing account in place and replaces its credential secret",async()=>{
  const accounts=new InMemoryAccountRepository(),secrets=new InMemorySecretStore(),id="9c05c6ec-17a4-4378-bccf-9af6ea902a6f";
  await accounts.upsert({id,messenger:"telegram",providerAccountId:"+79990000000",credentialRef:`telegram:${id}`,amoAccountId:"amo",sourceExternalId:"source",config:{phone:"+79990000000"},state:"reconnect_required"});
  await secrets.put(`telegram:${id}`,{apiId:1,apiHash:"old-hash",session:""});
  const disconnect=vi.fn(async()=>undefined);
  const service=new TelegramOnboardingService(secrets,accounts,()=>({beginAuthorization:vi.fn(async()=>({method:"app",nextMethod:"sms",canResend:true} as const)),submitAuthorizationCode:vi.fn(async()=>"completed" as const),submitAuthorizationPassword:vi.fn(),resendAuthorizationCode:vi.fn(async()=>({method:"sms",canResend:false} as const)),authorizationSession:()=>"authorized-session",disconnect}));
  const started=await service.start({accountId:id,phone:"+79990000000",apiId:42,apiHash:"new-hash",amoAccountId:"ignored",sourceExternalId:"ignored"});
  expect(started.accountId).toBe(id);expect(service.getDelivery(id)).toEqual({method:"app",nextMethod:"sms",canResend:true});
  await expect(service.submitCode(id,"12345")).resolves.toEqual({status:"completed"});
  expect(await accounts.listAll()).toHaveLength(1);expect(await accounts.get(id)).toMatchObject({credentialRef:`telegram:${id}`,sourceExternalId:"source",state:"disconnected"});
  expect(await secrets.get(`telegram:${id}`)).toEqual({apiId:42,apiHash:"new-hash",session:"authorized-session",authorized:true});expect(disconnect).toHaveBeenCalledOnce();
 });
 it("exposes Telegram app and SMS delivery metadata without the code hash",async()=>{
  const appClient={connected:false,connect:vi.fn(async()=>{appClient.connected=true;}),invoke:vi.fn(async()=>({phoneCodeHash:"secret-hash",type:{className:"auth.SentCodeTypeApp"},nextType:{className:"auth.CodeTypeSms"}})),session:{save:()=>""}};
  const app=new TelegramAdapter({accountId:"app",apiId:1,apiHash:"hash",session:"",client:appClient as any});await expect(app.beginAuthorization("+79990000000")).resolves.toEqual({method:"app",nextMethod:"sms",canResend:true});
  const smsClient={connected:false,connect:vi.fn(async()=>{smsClient.connected=true;}),invoke:vi.fn(async()=>({phoneCodeHash:"secret-hash",type:{className:"auth.SentCodeTypeSms"}})),session:{save:()=>""}};
  const sms=new TelegramAdapter({accountId:"sms",apiId:1,apiHash:"hash",session:"",client:smsClient as any});await expect(sms.beginAuthorization("+79990000000")).resolves.toEqual({method:"sms",canResend:false});
 });
 it("logs only the approved Telegram error fields and keeps the API error safe",async()=>{const accounts=new InMemoryAccountRepository(),secrets=new InMemorySecretStore(),logger={error:vi.fn()};const error=Object.assign(new Error("CONNECT_TIMEOUT"),{errorMessage:"TIMEOUT",errorCode:500,apiHash:"secret-hash",phoneCodeHash:"secret-code-hash",session:"secret-session"});const service=new TelegramOnboardingService(secrets,accounts,()=>({beginAuthorization:async()=>{throw error;},submitAuthorizationCode:vi.fn(),submitAuthorizationPassword:vi.fn(),resendAuthorizationCode:vi.fn(),authorizationSession:()=>"",disconnect:vi.fn()}),logger);await expect(service.start({phone:"+79990000000",apiId:42,apiHash:"secret-hash",amoAccountId:"amo",sourceExternalId:"source"})).rejects.toThrow("Telegram authorization failed");expect(logger.error).toHaveBeenCalledWith({errorClass:"Error",errorMessage:"TIMEOUT",errorCode:500,message:"CONNECT_TIMEOUT"},"Telegram authorization failed");expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret-");});
 it("does not construct a Telegram client for a missing or unauthorised session",async()=>{const secrets=new InMemorySecretStore(),queue=new InMemoryJobQueue();await secrets.put("telegram:empty",{apiId:1,apiHash:"hash",session:"",authorized:false});await expect(new AdapterFactory(secrets,queue).create({id:"empty",messenger:"telegram",providerAccountId:"p",credentialRef:"telegram:empty",amoAccountId:"amo",sourceExternalId:"source",config:{},state:"reconnect_required"})).rejects.toThrow("authorization required");});
});
