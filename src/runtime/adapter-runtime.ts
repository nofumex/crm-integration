import type { AccountRepository,MessengerAccount } from "../domain/accounts.js";
import type { NormalizedMessage } from "../domain/messages.js";
import { InMemoryAdapterRegistry,type MessengerAdapter } from "../adapters/messenger-adapter.js";
import { TelegramAdapter } from "../adapters/telegram-adapter.js";
import type { SecretStore } from "../security/secret-store.js";
import type { JobQueue } from "../queue/job-queue.js";
import type { MediaStore } from "../media/media-store.js";

type TelegramSecret={apiId:number;apiHash:string;session:string;authorized?:boolean};
export class WhatsAppPersonalUnavailableError extends Error{constructor(){super("WhatsApp Personal has no public, documented first-party Linked Devices API/SDK; runtime activation is refused");this.name="WhatsAppPersonalUnavailableError";}}
export class MaxPersonalUnavailableError extends Error{constructor(){super("MAX Personal has no public, documented first-party linked-device API/SDK; runtime activation is refused");this.name="MaxPersonalUnavailableError";}}

export class AdapterFactory {
 constructor(private readonly secrets:SecretStore,private readonly queue:JobQueue,private readonly mediaStore?:MediaStore,private readonly maxMediaBytes=25*1024*1024){}
 async create(account:MessengerAccount):Promise<MessengerAdapter>{
  let adapter:MessengerAdapter;
  if(account.messenger==="telegram"){const s=await this.required<TelegramSecret>(account.credentialRef);if(s.authorized===false||!s.session.trim())throw new Error("Telegram authorization required");adapter=new TelegramAdapter({accountId:account.id,apiId:Number(s.apiId),apiHash:s.apiHash,session:s.session,mediaStore:this.mediaStore,maxMediaBytes:this.maxMediaBytes});}
  else if(account.messenger==="whatsapp")throw new WhatsAppPersonalUnavailableError();
  else throw new MaxPersonalUnavailableError();
  adapter.onInbound(message=>this.enqueueInbound(message));
  adapter.onStatus((accountId,id,status,occurredAt)=>this.queue.enqueue({kind:"messenger.status",partitionKey:`${account.messenger}:${accountId}:${id}`,dedupeKey:`${accountId}:${id}:${status}:${occurredAt.getTime()}`,payload:{messenger:account.messenger,accountId,id,status,occurredAt:occurredAt.toISOString()}}).then(()=>undefined));
  return adapter;
 }
 private async required<T extends Record<string,unknown>>(id:string):Promise<T>{const value=await this.secrets.get<T>(id);if(!value)throw new Error(`Credential reference ${id} was not found`);return value;}
 private async enqueueInbound(message:NormalizedMessage):Promise<void>{await this.queue.enqueue({kind:"messenger.inbound",partitionKey:`${message.messenger}:${message.accountId}:${message.conversationId}`,dedupeKey:`${message.accountId}:${message.conversationId}:${message.id}`,payload:{...message,occurredAt:message.occurredAt.toISOString(),raw:undefined}});}
}

export class ReconnectSupervisor {
 private readonly failures=new Map<string,number>();
 private readonly nextAttemptAt=new Map<string,number>();
 constructor(private readonly accounts:AccountRepository,private readonly registry:InMemoryAdapterRegistry,private readonly factory:AdapterFactory,private readonly logger?:{info(data:unknown,message?:string):void;error(data:unknown,message?:string):void}){}
 async reconcile():Promise<void>{for(const account of await this.accounts.listEnabled())await this.ensure(account);}
 async run(signal:AbortSignal,intervalMs=10_000):Promise<void>{while(!signal.aborted){await this.reconcile();await delay(intervalMs,signal);}}
 async shutdown():Promise<void>{await Promise.allSettled(this.registry.all().map(a=>a.disconnect(a.accountId)));}
 async disconnectAccount(accountId:string):Promise<void>{const account=await this.accounts.get(accountId);if(!account)throw new Error(`Unknown account ${accountId}`);const adapter=this.registry.get(account.messenger,accountId);if(adapter){await adapter.disconnect(accountId);this.registry.remove(account.messenger,accountId);}this.failures.delete(accountId);this.nextAttemptAt.delete(accountId);await this.accounts.setState(accountId,"disconnected");}
 async reconnectAccount(accountId:string):Promise<void>{const account=await this.accounts.get(accountId);if(!account)throw new Error(`Unknown account ${accountId}`);if(account.state==="disabled")throw new Error("Account is disabled");this.failures.delete(accountId);this.nextAttemptAt.delete(accountId);await this.ensure(account,true);}
 private async ensure(account:MessengerAccount,force=false):Promise<void>{if(account.state==="connecting"||(!force&&account.state==="reconnect_required"))return;const existing=this.registry.get(account.messenger,account.id);if(existing&&(await existing.health(account.id)).connected){this.failures.delete(account.id);this.nextAttemptAt.delete(account.id);return;}const attempts=this.failures.get(account.id)??0;if(Date.now()<(this.nextAttemptAt.get(account.id)??0))return;try{await this.accounts.setState(account.id,"connecting");const adapter=existing??await this.factory.create(account);if(!existing)this.registry.register(adapter);await adapter.connect(account.id);await this.accounts.setState(account.id,"connected");this.failures.delete(account.id);this.nextAttemptAt.delete(account.id);this.logger?.info({accountId:account.id,messenger:account.messenger},"adapter connected");}catch(error){const n=attempts+1;this.failures.set(account.id,n);const message=error instanceof Error?error.message:"connection failed";await this.accounts.setState(account.id,/not authorized|authorization required/i.test(message)?"reconnect_required":"error",message);this.nextAttemptAt.set(account.id,Date.now()+Math.min(300_000,1000*2**Math.min(n,8))*(0.5+Math.random()*0.5));this.logger?.error({accountId:account.id,messenger:account.messenger},"adapter connect failed");}}
}
function delay(ms:number,signal:AbortSignal){return new Promise<void>(resolve=>{if(signal.aborted)return resolve();const t=setTimeout(done,ms);function done(){clearTimeout(t);signal.removeEventListener("abort",done);resolve();}signal.addEventListener("abort",done,{once:true});});}
