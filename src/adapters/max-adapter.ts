import type { InboundHandler, MessengerAdapter, StatusHandler } from "./messenger-adapter.js";
import type { NormalizedMessage, SendMessageCommand, SendResult } from "../domain/messages.js";
import type { MediaStore } from "../media/media-store.js";
import { HttpError } from "../http/http-error.js";

interface MaxOptions { accountId:string; token: string; baseUrl?: string; transport?: typeof fetch;timeoutMs?:number;mediaStore?:MediaStore;webhookUrl?:string;webhookSecret?:string }

/** Official MAX Bot API adapter. It intentionally does not emulate a personal MAX account. */
export class MaxAdapter implements MessengerAdapter {
  readonly kind = "max" as const;
  readonly accountId:string;
  private inbound?: InboundHandler;
  private status?: StatusHandler;
  private connected = false;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: MaxOptions) { this.accountId=options.accountId;this.fetcher = options.transport ?? fetch; }
  onInbound(handler: InboundHandler): void { this.inbound = handler; }
  onStatus(handler: StatusHandler): void { this.status = handler; }
  async connect(): Promise<void> {const base=this.options.baseUrl??"https://platform-api2.max.ru";const url=`${base}/me`;const headers={Authorization:this.options.token};const r=await this.fetcher(url,{headers,signal:AbortSignal.timeout(this.options.timeoutMs??15_000)});if(!r.ok)throw maxHttp(r,"GET",url);if(this.options.webhookUrl){if(!this.options.webhookSecret)throw new Error("MAX webhook secret is required");const subscription=`${base}/subscriptions`;const listed=await this.fetcher(subscription,{headers,signal:AbortSignal.timeout(this.options.timeoutMs??15_000)});if(!listed.ok)throw maxHttp(listed,"GET",subscription);const body=await listed.json() as any;const existing=body?.subscriptions??body;if(!Array.isArray(existing)||!existing.some((x:any)=>x.url===this.options.webhookUrl)){const created=await this.fetcher(subscription,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({url:this.options.webhookUrl,update_types:["message_created"],secret:this.options.webhookSecret}),signal:AbortSignal.timeout(this.options.timeoutMs??15_000)});if(!created.ok)throw maxHttp(created,"POST",subscription);}}this.connected=true;}
  async disconnect(): Promise<void> { this.connected = false; }
  async health(): Promise<{ connected: boolean; detail: string }> { return { connected: this.connected, detail: "official-bot-api-only" }; }
  async resolveRecipient(_identifier:{phone?:string;username?:string}):Promise<{providerRecipientId:string;providerConversationId:string}>{throw new Error("MAX bots cannot initiate a personal dialog before the user starts the bot");}

  async send(command: SendMessageCommand): Promise<SendResult> {
    const base = this.options.baseUrl ?? "https://platform-api2.max.ru";
    const query = new URLSearchParams({ user_id: command.recipientId });
    const attachments=[] as any[];for(const item of command.attachments??[]){if(!item.url)throw new Error("MAX attachment has no URL");if(item.kind==="image"){attachments.push({type:"image",payload:{url:item.url}});continue;}const type=item.kind==="video"?"video":item.kind==="audio"||item.kind==="voice"?"audio":"file";const slotUrl=`${base}/uploads?type=${type}`;const slotResponse=await this.fetcher(slotUrl,{method:"POST",headers:{Authorization:this.options.token}});if(!slotResponse.ok)throw maxHttp(slotResponse,"POST",slotUrl);const slot=await slotResponse.json() as any;const media=await this.fetcher(item.url);if(!media.ok)throw maxHttp(media,"GET",item.url);const form=new FormData();form.append("data",new Blob([await media.arrayBuffer()],{type:item.mimeType}),item.fileName??"media.bin");const uploaded=await this.fetcher(slot.url,{method:"POST",body:form});if(!uploaded.ok)throw maxHttp(uploaded,"POST",slot.url);const result=await uploaded.json() as any;const token=result.token??slot.token;if(!token)throw new Error("MAX media upload returned no token");attachments.push({type,payload:{token}});}
    const response = await this.fetcher(`${base}/messages?${query}`, {
      method: "POST", headers: { Authorization: this.options.token, "Content-Type": "application/json" },
      body: JSON.stringify({ text: command.text ?? "", attachments }),
      signal:AbortSignal.timeout(this.options.timeoutMs??15_000),
    });
    if (!response.ok) throw maxHttp(response,"POST",`${base}/messages`);
    const json = await response.json() as any;
    const id = String(json?.body?.mid ?? json?.message?.body?.mid ?? json?.message_id ?? "");
    if (!id) throw new Error("MAX Bot API response has no message id");
    return { externalMessageId: id, status: "sent", occurredAt: new Date() };
  }

  async acceptUpdate(update: any, accountId: string): Promise<void> {
    if (update?.update_type !== "message_created" || !this.inbound) return;
    const msg = update.message;
    const attachments = await Promise.all((msg.body?.attachments ?? []).map(async (a: any) => {
      const kind = a.type === "image" ? "image" : a.type === "video" ? "video" : a.type === "audio" ? "audio" : "file";
      const url = maxAttachmentUrl(a);
      if (url && this.options.mediaStore) return { id:a.payload?.token,kind,...await this.options.mediaStore.ingestRemote({url,kind,sourceId:`max:${msg.body.mid}:${a.payload?.token??a.type}`}) };
      return { id:a.payload?.token,kind,url };
    }));
    const normalized: NormalizedMessage = {
      id: String(msg.body.mid), messenger: "max", accountId,
      conversationId: String(msg.recipient?.chat_id ?? msg.body?.chat_id), direction: "inbound",
      sender: { externalId: String(msg.sender?.user_id), displayName: msg.sender?.name }, text: msg.body?.text,
      attachments,
      occurredAt: unixDate(Number(msg.timestamp ?? update.timestamp)), status: "delivered", raw: update,
    };
    await this.inbound(normalized);
  }
}

function unixDate(value: number): Date { return new Date(value > 1_000_000_000_000 ? value : value * 1000); }
function maxAttachmentUrl(a:any):string|undefined{return a?.payload?.url??a?.payload?.file?.url??a?.payload?.photos?.large??a?.url;}
function maxHttp(response:Response,method:string,url:string){const value=response.headers.get("retry-after");const seconds=value?Number(value):NaN;return new HttpError(response.status,method,url,Number.isFinite(seconds)?seconds*1000:undefined);}
