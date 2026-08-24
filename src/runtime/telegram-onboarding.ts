import { randomUUID } from "node:crypto";
import type { AccountRepository } from "../domain/accounts.js";
import type { SecretStore } from "../security/secret-store.js";
import { TelegramAdapter, type TelegramCodeDelivery } from "../adapters/telegram-adapter.js";
import { sourceExternalIdForAccount } from "../amocrm/source-reconciliation.js";

interface StartInput { accountId?:string;phone:string;displayName?:string;amoAccountId:string; }
interface Pending { adapter:AuthorizingAdapter;credentialRef:string;delivery:TelegramCodeDelivery;awaitingPassword:boolean; }
type AuthorizingAdapter={beginAuthorization(phone:string):Promise<TelegramCodeDelivery>;submitAuthorizationCode(code:string):Promise<"completed"|"awaiting_password">;submitAuthorizationPassword(password:string):Promise<void>;resendAuthorizationCode():Promise<TelegramCodeDelivery>;authorizationSession():string;disconnect():Promise<void>};

export class TelegramOnboardingService {
 private readonly pending=new Map<string,Pending>();
 constructor(private readonly secrets:SecretStore,private readonly accounts:AccountRepository,private readonly settings:{apiId:number;apiHash:string},private readonly createAdapter:(input:{accountId:string;apiId:number;apiHash:string})=>AuthorizingAdapter=input=>new TelegramAdapter({...input,session:""}),private readonly logger?:{error(data:unknown,message?:string):void}){}
 async start(input:StartInput):Promise<{accountId:string;status:"awaiting_code"}>{
  const accountId=input.accountId??randomUUID();if(this.pending.has(accountId))throw new Error("Onboarding already active");
  const existing=input.accountId?await this.accounts.get(accountId):undefined;if(input.accountId&&!existing)throw new Error("Unknown Telegram account");if(existing&&existing.messenger!=="telegram")throw new Error("Account is not Telegram");
  const credentialRef=existing?.credentialRef??`telegram:${accountId}`;
  if(existing)await this.accounts.setState(accountId,"connecting");else {await this.secrets.put(credentialRef,{session:"",authorized:false});try{await this.accounts.upsert({id:accountId,messenger:"telegram",providerAccountId:input.phone.replace(/\s/g,""),displayName:input.displayName,credentialRef,amoAccountId:input.amoAccountId,sourceExternalId:sourceExternalIdForAccount(accountId),config:{phone:input.phone},state:"connecting"});}catch(error){await this.secrets.delete(credentialRef);throw error;}}
  const adapter=this.createAdapter({accountId,apiId:this.settings.apiId,apiHash:this.settings.apiHash});try{const delivery=await adapter.beginAuthorization(input.phone);this.pending.set(accountId,{adapter,credentialRef,delivery,awaitingPassword:false});return{accountId,status:"awaiting_code"};}catch(error){this.logAuthorizationError(error);await this.fail(accountId);throw new Error("Telegram authorization failed");}
 }
 async submitCode(accountId:string,code:string):Promise<{status:"awaiting_password"|"completed"}>{const p=this.required(accountId);try{const result=await p.adapter.submitAuthorizationCode(code);if(result==="awaiting_password"){p.awaitingPassword=true;return{status:"awaiting_password"};}await this.complete(accountId,p);return{status:"completed"};}catch(error){this.logAuthorizationError(error);await this.fail(accountId);throw new Error("Telegram authorization failed");}}
 async submitPassword(accountId:string,password:string):Promise<{status:"completed"}>{const p=this.required(accountId);if(!p.awaitingPassword)throw new Error("2FA password is not requested");try{await p.adapter.submitAuthorizationPassword(password);await this.complete(accountId,p);return{status:"completed"};}catch(error){this.logAuthorizationError(error);await this.fail(accountId);throw new Error("Telegram authorization failed");}}
 async resendCode(accountId:string):Promise<TelegramCodeDelivery>{const p=this.required(accountId);try{p.delivery=await p.adapter.resendAuthorizationCode();return p.delivery;}catch(error){this.logAuthorizationError(error);throw new Error("Telegram could not resend the authorization code");}}
 getStatus(accountId:string):null|"awaiting_code"|"awaiting_password"{const p=this.pending.get(accountId);if(!p)return null;return p.awaitingPassword?"awaiting_password":"awaiting_code";}
 getDelivery(accountId:string):TelegramCodeDelivery|undefined{return this.pending.get(accountId)?.delivery;}
 private required(id:string){const p=this.pending.get(id);if(!p)throw new Error("No active onboarding for account");return p;}
 private async complete(accountId:string,p:Pending){await this.secrets.put(p.credentialRef,{session:p.adapter.authorizationSession(),authorized:true});await this.accounts.setState(accountId,"disconnected");await p.adapter.disconnect();this.pending.delete(accountId);}
 private async fail(accountId:string){this.pending.delete(accountId);await this.accounts.setState(accountId,"reconnect_required","Telegram authorization failed");}
 private logAuthorizationError(error:unknown){const value=error as {constructor?:{name?:unknown};errorMessage?:unknown;errorCode?:unknown;message?:unknown};this.logger?.error({errorClass:typeof value?.constructor?.name==="string"?value.constructor.name:undefined,errorMessage:typeof value?.errorMessage==="string"?value.errorMessage:undefined,errorCode:typeof value?.errorCode==="number"||typeof value?.errorCode==="string"?value.errorCode:undefined,message:typeof value?.message==="string"?value.message:undefined},"Telegram authorization failed");}
}
