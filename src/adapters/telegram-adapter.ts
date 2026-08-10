import { TelegramClient } from "teleproto";
import { NewMessage } from "teleproto/events/index.js";
import { StringSession } from "teleproto/sessions/index.js";
import { readFile } from "node:fs/promises";
import type { InboundHandler, MessengerAdapter, StatusHandler } from "./messenger-adapter.js";
import type { NormalizedAttachment, NormalizedMessage, SendMessageCommand, SendResult } from "../domain/messages.js";
import type { MediaStore } from "../media/media-store.js";

export interface TelegramOptions {
  apiId: number;
  apiHash: string;
  accountId: string;
  session: string;
  connectionRetries?: number;
  mediaStore?: MediaStore;
  /** Test seam; production creates a real MTProto client from the encrypted session. */
  client?: TelegramClient;
  maxMediaBytes?: number;
  timeoutMs?:number;
}

export interface TelegramAuthorizationPrompts {
  phoneNumber: () => Promise<string>;
  phoneCode: () => Promise<string>;
  password: () => Promise<string>;
  onError?: (error: Error) => void;
}

/** MTProto user-account adapter using GramJS; one instance represents one Telegram account/session. */
export class TelegramAdapter implements MessengerAdapter {
  readonly kind = "telegram" as const;
  readonly accountId: string;
  private readonly client: TelegramClient;
  private inbound?: InboundHandler;
  private status?: StatusHandler;
  private handlerInstalled = false;

  constructor(private readonly options: TelegramOptions) {
    this.accountId=options.accountId;
    this.client = options.client ?? new TelegramClient(new StringSession(options.session), options.apiId, options.apiHash, {
      connectionRetries: options.connectionRetries ?? 10,
      autoReconnect: true,
    });
  }

  onInbound(handler: InboundHandler): void { this.inbound = handler; }
  onStatus(handler: StatusHandler): void { this.status = handler; }

  async authorize(prompts: TelegramAuthorizationPrompts): Promise<string> {
    await withTimeout(this.client.start({ ...prompts, onError: prompts.onError ?? (() => undefined) }),5*60_000);
    this.installHandler();
    return String(this.client.session.save());
  }

  async connect(accountId: string): Promise<void> {
    if (accountId !== this.options.accountId) throw new Error("Telegram adapter/account mismatch");
    await withTimeout(this.client.connect(),this.timeout());
    if (!(await withTimeout(this.client.isUserAuthorized(),this.timeout()))) throw new Error("Telegram session is not authorized; complete interactive authorization first");
    this.installHandler();
  }

  async disconnect(): Promise<void> { await withTimeout(this.client.disconnect(),this.timeout()); }
  async health(): Promise<{ connected: boolean; detail?: string }> {
    return { connected: Boolean(this.client.connected), detail: this.client.connected ? undefined : "disconnected" };
  }

  async resolveRecipient(identifier:{phone?:string;username?:string}):Promise<{providerRecipientId:string;providerConversationId:string}>{
    const value=identifier.username??identifier.phone;if(!value)throw new Error("Telegram recipient phone or username is required");
    const entity:any=await withTimeout(this.client.getEntity(value),this.timeout());const id=String(entity.id);return{providerRecipientId:id,providerConversationId:id};
  }

  async send(command: SendMessageCommand): Promise<SendResult> {
    const attachment = command.attachments?.[0];
    const result = await withTimeout(attachment?.url
      ? this.client.sendFile(command.conversationId, { file: attachment.url, caption: command.text, ...(command.replyToId ? { replyTo: Number(command.replyToId) } : {}) })
      : this.client.sendMessage(command.conversationId, { message: command.text ?? "", ...(command.replyToId ? { replyTo: Number(command.replyToId) } : {}) }),this.timeout());
    return { externalMessageId: String((result as any).id), status: "sent", occurredAt: new Date(Number((result as any).date) * 1000) };
  }

  private installHandler(): void {
    if (this.handlerInstalled) return;
    this.client.addEventHandler(async (event: any) => {
      if (!this.inbound || event.message?.out) return;
      const msg = event.message;
      const chatId = String(msg.chatId ?? msg.peerId?.userId ?? msg.peerId?.chatId ?? msg.peerId?.channelId);
      const senderId = String(msg.senderId ?? msg.peerId?.userId ?? "unknown");
      const attachments: NormalizedAttachment[] = msg.media ? [{ kind: inferTelegramMediaKind(msg.media), id: String(msg.id) }] : [];
      if (msg.media && this.options.mediaStore) {
        const declaredSize=Number(msg.media?.document?.size??0);if(declaredSize>(this.options.maxMediaBytes??25*1024*1024))throw new Error("Telegram media exceeds size limit");
        const downloaded = await withTimeout(this.client.downloadMedia(msg.media, {}),this.timeout());
        if (downloaded) {
          const data = typeof downloaded === "string" ? await readFile(downloaded) : Buffer.from(downloaded);
          const published = await this.options.mediaStore.put({ data, kind: attachments[0]!.kind, sourceId: `${chatId}:${msg.id}` });
          attachments[0]!.url = published.url; attachments[0]!.size = published.size;
        }
      }
      const normalized: NormalizedMessage = {
        id: String(msg.id), messenger: "telegram", accountId: this.options.accountId, conversationId: chatId,
        direction: "inbound", sender: { externalId: senderId }, text: msg.message || undefined,
        attachments, replyToId: msg.replyTo?.replyToMsgId ? String(msg.replyTo.replyToMsgId) : undefined,
        mediaGroupId: msg.groupedId ? String(msg.groupedId) : undefined,
        occurredAt: new Date(Number(msg.date) * 1000), status: "delivered", raw: msg,
      };
      await this.inbound(normalized);
    }, new NewMessage({ incoming: true }));
    this.handlerInstalled = true;
  }
  private timeout(){return this.options.timeoutMs??15_000;}
}

function inferTelegramMediaKind(media: any): NormalizedAttachment["kind"] {
  const name = media?.className ?? media?.constructor?.name ?? "";
  if (/Photo/i.test(name)) return "image";
  const mime = media?.document?.mimeType ?? "";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return media?.document?.attributes?.some((a: any) => a.voice) ? "voice" : "audio";
  if (/Sticker/i.test(name)) return "sticker";
  return "file";
}
function withTimeout<T>(promise:Promise<T>,ms:number):Promise<T>{let timer:NodeJS.Timeout|undefined;return Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new DOMException("Operation timed out","TimeoutError")),ms);timer.unref?.();})]).finally(()=>{if(timer)clearTimeout(timer);});}
