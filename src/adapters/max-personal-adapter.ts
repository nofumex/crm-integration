import type{InboundHandler,MessengerAdapter,StatusHandler}from"./messenger-adapter.js";
import type{NormalizedMessage,SendMessageCommand,SendResult}from"../domain/messages.js";

/** Contract to be implemented only from MAX-approved linked-device SDK/API documentation. */
export interface MaxPersonalPartnerClient{
 beginQrLogin(input:{signal:AbortSignal;onQr(qrPayload:string,expiresAt:Date):Promise<void>;request2FA():Promise<string>}):Promise<{session:string;providerAccountId:string}>;
 connect(input:{session:string;signal:AbortSignal}):Promise<void>;disconnect():Promise<void>;health():Promise<{connected:boolean;detail?:string}>;
 resolveRecipient(identifier:{phone?:string;username?:string},signal:AbortSignal):Promise<{providerRecipientId:string;providerConversationId:string}>;
 send(command:SendMessageCommand,signal:AbortSignal):Promise<SendResult>;
 onInbound(handler:(message:NormalizedMessage)=>Promise<void>):void;onStatus(handler:StatusHandler):void;
}
export type MaxPersonalClientFactory=(accountId:string)=>MaxPersonalPartnerClient;
export class MaxPersonalPartnerAccessError extends Error{constructor(){super("MAX Personal is blocked until MAX grants documented linked-device Partner API/SDK access");this.name="MaxPersonalPartnerAccessError";}}

export class MaxPersonalAdapter implements MessengerAdapter{
 readonly kind="max" as const;readonly accountId:string;private inbound?:InboundHandler;private status?:StatusHandler;
 constructor(private readonly options:{accountId:string;session:string;client?:MaxPersonalPartnerClient;timeoutMs?:number}){this.accountId=options.accountId;if(options.client){options.client.onInbound(m=>this.inbound?.(m)??Promise.resolve());options.client.onStatus((...args)=>this.status?.(...args)??Promise.resolve());}}
 onInbound(handler:InboundHandler){this.inbound=handler;}onStatus(handler:StatusHandler){this.status=handler;}
 async authorizeQr(callbacks:{onQr(qrPayload:string,expiresAt:Date):Promise<void>;request2FA():Promise<string>}):Promise<{session:string;providerAccountId:string}>{const client=this.required();return withTimeout(signal=>client.beginQrLogin({...callbacks,signal}),this.timeout());}
 async connect(accountId:string){if(accountId!==this.accountId)throw new Error("MAX Personal adapter/account mismatch");const client=this.required();if(!this.options.session)throw new Error("MAX Personal linked-device session is missing");await withTimeout(signal=>client.connect({session:this.options.session,signal}),this.timeout());}
 async disconnect(){if(this.options.client)await withTimeout(()=>this.options.client!.disconnect(),this.timeout());}
 async health(){return this.options.client?this.options.client.health():{connected:false,detail:"blocked-by-partner-api-access"};}
 async resolveRecipient(identifier:{phone?:string;username?:string}){const client=this.required();return withTimeout(signal=>client.resolveRecipient(identifier,signal),this.timeout());}
 async send(command:SendMessageCommand){const client=this.required();return withTimeout(signal=>client.send(command,signal),this.timeout());}
 private required(){if(!this.options.client)throw new MaxPersonalPartnerAccessError();return this.options.client;}private timeout(){return this.options.timeoutMs??15_000;}
}
async function withTimeout<T>(operation:(signal:AbortSignal)=>Promise<T>,timeoutMs:number){const controller=new AbortController();let timer:NodeJS.Timeout|undefined;const timeout=new Promise<T>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new DOMException("Operation timed out","TimeoutError"));},timeoutMs);timer.unref?.();});try{return await Promise.race([operation(controller.signal),timeout]);}finally{if(timer)clearTimeout(timer);}}
