import type{JobHandler}from"./worker.js";
import type{AdapterRegistry}from"../adapters/messenger-adapter.js";
import type{MessageRouter}from"../router/message-router.js";
import type{NormalizedMessage,MessengerKind}from"../domain/messages.js";

export function createRuntimeHandlers(router:MessageRouter,adapters:AdapterRegistry):Record<"amocrm.outbound"|"messenger.inbound"|"messenger.status",JobHandler>{return{
 "amocrm.outbound":async job=>{const p=job.payload as any;await router.routeAmoOutbound(p.body,p.scopeId);},
 "messenger.inbound":async job=>{const p=job.payload as any;if(p.adapterWebhook)throw new Error("Unsupported adapter webhook");await router.routeInbound({...p,occurredAt:new Date(p.occurredAt),attachments:p.attachments??[]} as NormalizedMessage);},
 "messenger.status":async job=>{const p=job.payload as any;if(p.adapterWebhook){const adapter:any=required(adapters,p.messenger,p.accountId);await adapter.acceptWebhook(p.body);return;}await router.routeStatus(p);},
};}
function required(registry:AdapterRegistry,kind:MessengerKind,id:string){const a=registry.get(kind,id);if(!a)throw new Error(`Adapter ${kind}:${id} is not connected`);return a;}
