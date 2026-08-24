import type { AccountRepository } from "../domain/accounts.js";
import type { AmoCrmRestClient } from "./rest-client.js";
import type { AmoCrmChatsClient } from "./chats-client.js";

export interface AmoChatsConnectResult {scopeId:string;connectResponse:{account_id?:string;scope_id:string;title?:string;hook_api_version?:string;is_time_window_disabled?:boolean};sharedScopeAccountIds:string[];}

export class AmoChatsLifecycle {
 constructor(private readonly rest:AmoCrmRestClient,private readonly chats:AmoCrmChatsClient,private readonly accounts:AccountRepository,private readonly logger?:{warn(data:unknown,message?:string):void}){}
 async connectAccount(accountId:string,title?:string):Promise<AmoChatsConnectResult>{const account=await this.accounts.get(accountId);if(!account)throw new Error(`Unknown account ${accountId}`);const data:any=await this.rest.getAccountWithAmojoId();if(!data?.amojo_id)throw new Error("amoCRM account response has no amojo_id");if(String(data.id)!==String(account.amoAccountId))throw new Error("amoCRM credential/account mismatch");const connected:any=await this.chats.connectChannel(String(data.amojo_id),title??account.displayName);if(!connected?.scope_id)throw new Error("amoCRM Chats /connect returned no scope_id");const scopeId=String(connected.scope_id);await this.accounts.setScope(account.id,scopeId);const sharedScopeAccountIds=(await this.accounts.listAll()).filter(x=>x.id!==account.id&&x.amoScopeId===scopeId).map(x=>x.id);const result={scopeId,connectResponse:connectResponse(connected,scopeId),sharedScopeAccountIds};if(sharedScopeAccountIds.length)this.logger?.warn({accountId:account.id,scopeId,sharedScopeAccountIds},"amoCRM Chats scope is shared by messenger accounts; it cannot distinguish Telegram accounts without supported sources");return result;}
}

function connectResponse(value:any,scopeId:string){return{...(typeof value?.account_id==="string"?{account_id:value.account_id}:{}),scope_id:scopeId,...(typeof value?.title==="string"?{title:value.title}:{}),...(typeof value?.hook_api_version==="string"?{hook_api_version:value.hook_api_version}:{}),...(typeof value?.is_time_window_disabled==="boolean"?{is_time_window_disabled:value.is_time_window_disabled}:{})};}
