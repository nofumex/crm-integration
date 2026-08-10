import type { AccountRepository } from "../domain/accounts.js";
import type { AmoCrmRestClient } from "./rest-client.js";
import type { AmoCrmChatsClient } from "./chats-client.js";

export class AmoChatsLifecycle {
 constructor(private readonly rest:AmoCrmRestClient,private readonly chats:AmoCrmChatsClient,private readonly accounts:AccountRepository){}
 async connectAccount(accountId:string,title?:string):Promise<string>{const account=await this.accounts.get(accountId);if(!account)throw new Error(`Unknown account ${accountId}`);const data:any=await this.rest.getAccountWithAmojoId();if(!data?.amojo_id)throw new Error("amoCRM account response has no amojo_id");if(String(data.id)!==String(account.amoAccountId))throw new Error("amoCRM credential/account mismatch");const connected:any=await this.chats.connectChannel(String(data.amojo_id),title??account.displayName);if(!connected?.scope_id)throw new Error("amoCRM Chats /connect returned no scope_id");await this.accounts.setScope(account.id,String(connected.scope_id));return String(connected.scope_id);}
 async ensureSource(accountId:string,pipelineId?:number):Promise<void>{const account=await this.accounts.get(accountId);if(!account)throw new Error(`Unknown account ${accountId}`);const existing:any=await this.rest.findSources(account.sourceExternalId);if((existing?._embedded?.sources??[]).length)return;const services=account.messenger==="whatsapp"?[{type:"whatsapp",params:{waba:true}}]:undefined;await this.rest.createSources([{name:account.displayName??`${account.messenger} ${account.providerAccountId}`,external_id:account.sourceExternalId,...(pipelineId?{pipeline_id:pipelineId}:{}),...(services?{services}:{})}]);}
}
