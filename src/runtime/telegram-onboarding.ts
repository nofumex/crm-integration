import { randomUUID } from "node:crypto";
import type { AccountRepository,MessengerAccount } from "../domain/accounts.js";
import type { SecretStore } from "../security/secret-store.js";
import { TelegramAdapter } from "../adapters/telegram-adapter.js";

interface StartInput { accountId?:string;phone:string;apiId:number;apiHash:string;displayName?:string;amoAccountId:string;sourceExternalId:string; }
interface Pending { code?:Deferred<string>;password?:Deferred<string>;completion:Promise<void>; }
interface Deferred<T>{promise:Promise<T>;resolve(value:T):void;reject(error:unknown):void;}

export class TelegramOnboardingService {
 private readonly pending=new Map<string,Pending>();
 constructor(private readonly secrets:SecretStore,private readonly accounts:AccountRepository){}
 async start(input:StartInput):Promise<{accountId:string;status:"awaiting_code"}>{
  const accountId=input.accountId??randomUUID();if(this.pending.has(accountId))throw new Error("Onboarding already active");
  const credentialRef=`telegram:${accountId}`;await this.secrets.put(credentialRef,{apiId:input.apiId,apiHash:input.apiHash,session:""});
  const account:MessengerAccount={id:accountId,messenger:"telegram",providerAccountId:input.phone.replace(/\s/g,""),displayName:input.displayName,credentialRef,amoAccountId:input.amoAccountId,sourceExternalId:input.sourceExternalId,config:{phone:input.phone},state:"connecting"};await this.accounts.upsert(account);
  const adapter=new TelegramAdapter({accountId,apiId:input.apiId,apiHash:input.apiHash,session:""});const pending={} as Pending;
  pending.completion=adapter.authorize({phoneNumber:async()=>input.phone,phoneCode:async()=>{pending.code=deferred<string>();return pending.code.promise;},password:async()=>{pending.password=deferred<string>();return pending.password.promise;},onError:()=>undefined}).then(async session=>{await this.secrets.put(credentialRef,{apiId:input.apiId,apiHash:input.apiHash,session});await this.accounts.setState(accountId,"disconnected");await adapter.disconnect();}).catch(async error=>{await this.accounts.setState(accountId,"reconnect_required",error instanceof Error?error.message:"authorization failed");throw error;}).finally(()=>this.pending.delete(accountId));
  this.pending.set(accountId,pending);await waitUntil(()=>Boolean(pending.code),10_000);return{accountId,status:"awaiting_code"};
 }
 async submitCode(accountId:string,code:string):Promise<{status:"awaiting_password"|"completed"}>{const p=this.required(accountId);if(!p.code)throw new Error("Code is not requested");p.code.resolve(code);const result=await Promise.race([p.completion.then(()=>"completed" as const),waitUntil(()=>Boolean(p.password),10_000).then(()=>"awaiting_password" as const)]);return{status:result};}
 async submitPassword(accountId:string,password:string):Promise<{status:"completed"}>{const p=this.required(accountId);if(!p.password)throw new Error("2FA password is not requested");p.password.resolve(password);await p.completion;return{status:"completed"};}
 private required(id:string){const p=this.pending.get(id);if(!p)throw new Error("No active onboarding for account");return p;}
}
function deferred<T>():Deferred<T>{let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((res,rej)=>{resolve=res;reject=rej;});return{promise,resolve,reject};}
async function waitUntil(test:()=>boolean,timeoutMs:number){const end=Date.now()+timeoutMs;while(!test()){if(Date.now()>=end)throw new Error("Onboarding prompt timeout");await new Promise(r=>setTimeout(r,25));}}
