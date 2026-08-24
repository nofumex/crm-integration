import { Api, TelegramClient } from "teleproto";
import { NewMessage } from "teleproto/events/index.js";
import { StringSession } from "teleproto/sessions/index.js";
import { readFile } from "node:fs/promises";
import type { InboundHandler, MessengerAdapter, StatusHandler } from "./messenger-adapter.js";
import type { NormalizedAttachment, NormalizedMessage, NormalizedParticipant, SendMessageCommand, SendResult, TelegramProfile, TelegramRecipientReference } from "../domain/messages.js";
import type { MediaStore } from "../media/media-store.js";
import { TelegramRecipientResolutionError } from "../core/errors.js";

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
  logger?: { info(data: unknown, message?: string): void };
}

export interface TelegramAuthorizationPrompts {
  phoneNumber: () => Promise<string>;
  phoneCode: () => Promise<string>;
  password: () => Promise<string>;
  onError?: (error: Error) => void;
}
export interface TelegramCodeDelivery { method:"app"|"sms"|"email"|"other";nextMethod?:"app"|"sms"|"email"|"other";canResend:boolean; }

/** MTProto user-account adapter using GramJS; one instance represents one Telegram account/session. */
export class TelegramAdapter implements MessengerAdapter {
  readonly kind = "telegram" as const;
  readonly accountId: string;
  private readonly client: TelegramClient;
  private inbound?: InboundHandler;
  private status?: StatusHandler;
  private handlerInstalled = false;
  private authorization?:{phone:string;phoneCodeHash:string;delivery:TelegramCodeDelivery};

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

  async beginAuthorization(phone:string):Promise<TelegramCodeDelivery>{await withTimeout(this.client.connect(),this.timeout());const sent:any=await withTimeout((this.client as any).invoke(new Api.auth.SendCode({phoneNumber:phone,apiId:this.options.apiId,apiHash:this.options.apiHash,settings:new Api.CodeSettings({})})),this.timeout());if(!sent?.phoneCodeHash)throw new Error("Telegram did not return an authorization code");const delivery=codeDelivery(sent);this.authorization={phone,phoneCodeHash:String(sent.phoneCodeHash),delivery};return delivery;}
  async submitAuthorizationCode(code:string):Promise<"completed"|"awaiting_password">{const auth=this.requiredAuthorization();try{await withTimeout((this.client as any).invoke(new Api.auth.SignIn({phoneNumber:auth.phone,phoneCodeHash:auth.phoneCodeHash,phoneCode:code})),this.timeout());this.installHandler();return"completed";}catch(error){if((error as any)?.errorMessage==="SESSION_PASSWORD_NEEDED")return"awaiting_password";throw error;}}
  async submitAuthorizationPassword(password:string):Promise<void>{this.requiredAuthorization();await withTimeout((this.client as any).signInWithPassword({apiId:this.options.apiId,apiHash:this.options.apiHash},{password:async()=>password,onError:()=>true}),this.timeout());this.installHandler();}
  async resendAuthorizationCode():Promise<TelegramCodeDelivery>{const auth=this.requiredAuthorization();if(!auth.delivery.canResend)throw new Error("Telegram does not offer another code delivery method");const sent:any=await withTimeout((this.client as any).invoke(new Api.auth.ResendCode({phoneNumber:auth.phone,phoneCodeHash:auth.phoneCodeHash})),this.timeout());if(!sent?.phoneCodeHash)throw new Error("Telegram did not return a resent authorization code");const delivery=codeDelivery(sent);this.authorization={phone:auth.phone,phoneCodeHash:String(sent.phoneCodeHash),delivery};return delivery;}
  authorizationSession():string{this.requiredAuthorization();return String(this.client.session.save());}

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

  async resolveRecipient(identifier:{phone?:string;username?:string}):Promise<{providerRecipientId:string;providerConversationId:string;providerRecipientRef?:TelegramRecipientReference;providerProfile?:TelegramProfile}>{
    const value=identifier.username??identifier.phone;if(!value)throw new Error("Telegram recipient phone or username is required");
    try{const entity:any=await withTimeout(this.client.getEntity(value),this.timeout());const inputPeer=await withTimeout(this.client.getInputEntity(entity),this.timeout());const participant=telegramParticipant(entity,String(entity?.id??value),inputPeer);return{providerRecipientId:participant.externalId,providerConversationId:participant.externalId,providerRecipientRef:participant.recipientReference,providerProfile:participant.profile};}
    catch{if(!identifier.phone)throw new TelegramRecipientResolutionError();return this.resolveRecipientByPhone(identifier.phone);}
  }

  private async resolveRecipientByPhone(phone:string):Promise<{providerRecipientId:string;providerConversationId:string;providerRecipientRef?:TelegramRecipientReference;providerProfile?:TelegramProfile}>{
    let resolved:any;
    try{resolved=await withTimeout((this.client as any).invoke(new Api.contacts.ResolvePhone({phone})),this.timeout());}
    catch{throw new TelegramRecipientResolutionError();}
    this.options.logger?.info(resolvePhoneDiagnostics(resolved),"Telegram contacts.resolvePhone result");
    const peerUserId=resolved?.peer?.userId;const entity=(resolved?.users??[]).find((user:any)=>String(user?.id)===String(peerUserId));
    if(!entity)throw new TelegramRecipientResolutionError();
    let inputPeer:any;try{inputPeer=await withTimeout(this.client.getInputEntity(entity),this.timeout());}catch{throw new TelegramRecipientResolutionError();}
    const participant=telegramParticipant(entity,String(peerUserId),inputPeer);if(!participant.recipientReference)throw new TelegramRecipientResolutionError();
    return{providerRecipientId:participant.externalId,providerConversationId:participant.externalId,providerRecipientRef:participant.recipientReference,providerProfile:participant.profile};
  }

  async resolveRecipientById(providerRecipientId:string):Promise<{providerRecipientRef:TelegramRecipientReference;providerProfile?:TelegramProfile}>{
    let entity:any;let inputPeer:any;
    try { inputPeer=await withTimeout(this.client.getInputEntity(providerRecipientId),this.timeout());entity=await withTimeout(this.client.getEntity(inputPeer),this.timeout()); }
    catch { for await (const dialog of (this.client as any).iterDialogs({})){if(!dialog?.isUser||String(dialog.entity?.id)!==providerRecipientId)continue;entity=dialog.entity;inputPeer=dialog.inputEntity;break;} }
    const participant=telegramParticipant(entity,providerRecipientId,inputPeer);if(!participant.recipientReference)throw new TelegramRecipientResolutionError();return{providerRecipientRef:participant.recipientReference,providerProfile:participant.profile};
  }

  async send(command: SendMessageCommand): Promise<SendResult> {
    const recipient=await this.resolveInputPeer(command);
    const attachment = command.attachments?.[0];
    const result = await withTimeout(attachment?.url
      ? this.client.sendFile(recipient, { file: attachment.url, caption: command.text, ...(command.replyToId ? { replyTo: Number(command.replyToId) } : {}) })
      : this.client.sendMessage(recipient, { message: command.text ?? "", ...(command.replyToId ? { replyTo: Number(command.replyToId) } : {}) }),this.timeout());
    return { externalMessageId: String((result as any).id), status: "sent", occurredAt: new Date(Number((result as any).date) * 1000) };
  }

  private installHandler(): void {
    if (this.handlerInstalled) return;
    this.client.addEventHandler(async (event: any) => {
      if (!this.inbound || event.message?.out) return;
      const msg = event.message;
      const chatId = String(msg.chatId ?? msg.peerId?.userId ?? msg.peerId?.chatId ?? msg.peerId?.channelId);
      const senderId = String(msg.senderId ?? msg.peerId?.userId ?? "unknown");
      let sender:NormalizedParticipant;
      try { const entity=await withTimeout(this.client.getEntity(msg.senderId ?? senderId),this.timeout());sender=telegramParticipant(entity,senderId,await withTimeout(this.client.getInputEntity(entity),this.timeout())); }
      catch { try { sender=telegramParticipant(undefined,senderId,await withTimeout(this.client.getInputEntity(msg.senderId ?? senderId),this.timeout())); } catch { sender=telegramParticipant(undefined,senderId); } }
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
        direction: "inbound", sender, text: msg.message || undefined,
        attachments, replyToId: msg.replyTo?.replyToMsgId ? String(msg.replyTo.replyToMsgId) : undefined,
        mediaGroupId: msg.groupedId ? String(msg.groupedId) : undefined,
        occurredAt: new Date(Number(msg.date) * 1000), status: "delivered", raw: msg,
      };
      await this.inbound(normalized);
    }, new NewMessage({ incoming: true }));
    this.handlerInstalled = true;
  }
  private timeout(){return this.options.timeoutMs??15_000;}
  private requiredAuthorization(){if(!this.authorization)throw new Error("Telegram authorization has not started");return this.authorization;}
  private async resolveInputPeer(command:SendMessageCommand){
    const reference=command.recipientReference;
    const entity=reference?.kind==="telegram_input_peer_user"
      ? new Api.InputPeerUser({userId:reference.userId as any,accessHash:reference.accessHash as any})
      : command.recipientId;
    try{return await withTimeout(this.client.getInputEntity(entity as any),this.timeout());}
    catch {throw new TelegramRecipientResolutionError();}
  }
}

function telegramParticipant(entity:any,fallbackId:string,inputPeer?:any):NormalizedParticipant{
  const externalId=String(entity?.id??fallbackId);
  const firstName=nonEmpty(entity?.firstName),lastName=nonEmpty(entity?.lastName),username=nonEmpty(entity?.username),phone=nonEmpty(entity?.phone);
  const name=[firstName,lastName].filter(Boolean).join(" ");
  const profile:TelegramProfile={telegramId:externalId,...(firstName?{firstName}:{}),...(lastName?{lastName}:{}),...(username?{username}:{}),...(phone?{phone}:{}),...(typeof entity?.bot==="boolean"?{isBot:entity.bot}:{})};
  const accessHash=inputPeer?.className==="InputPeerUser"?inputPeer.accessHash:entity?.accessHash;
  const userId=inputPeer?.className==="InputPeerUser"?String(inputPeer.userId):externalId;
  return {externalId,displayName:name||username||externalId,...(username?{username}:{}),...(phone?{phone}:{}),...(accessHash!==undefined?{recipientReference:{kind:"telegram_input_peer_user",userId,accessHash:String(accessHash)}}:{}),...(Object.keys(profile).length?{profile}:{})};
}
function nonEmpty(value:unknown):string|undefined{return typeof value==="string"&&value.trim()?value.trim():undefined;}

function resolvePhoneDiagnostics(resolved: any): Record<string, unknown> {
  const users = Array.isArray(resolved?.users) ? resolved.users : [];
  return {
    hasPeer: Boolean(resolved?.peer),
    usersCount: users.length,
    peerUserIdPresent: resolved?.peer?.userId !== undefined && resolved?.peer?.userId !== null,
    users: users.map((user: any) => ({
      ...(user?.id !== undefined ? { id: String(user.id) } : {}),
      hasAccessHash: user?.accessHash !== undefined && user?.accessHash !== null,
      ...(typeof user?.className === "string" ? { className: user.className } : {}),
    })),
  };
}

function codeDelivery(sent:any):TelegramCodeDelivery{return{method:deliveryMethod(sent?.type?.className),...(sent?.nextType?{nextMethod:deliveryMethod(sent.nextType.className)}:{}),canResend:Boolean(sent?.nextType)};}
function deliveryMethod(className:unknown):TelegramCodeDelivery["method"]{const value=String(className??"");if(/App$/.test(value))return"app";if(/Sms$|SmsWord$|SmsPhrase$|FirebaseSms$|FragmentSms$/.test(value))return"sms";if(/Email/.test(value))return"email";return"other";}

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
