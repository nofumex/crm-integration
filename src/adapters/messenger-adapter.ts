import type { MessengerKind, NormalizedMessage, SendMessageCommand, SendResult } from "../domain/messages.js";

export type InboundHandler = (message: NormalizedMessage) => Promise<void>;
export type StatusHandler = (accountId: string, externalMessageId: string, status: SendResult["status"], occurredAt: Date) => Promise<void>;

export interface MessengerAdapter {
  readonly kind: MessengerKind;
  readonly accountId: string;
  connect(accountId: string): Promise<void>;
  disconnect(accountId: string): Promise<void>;
  send(command: SendMessageCommand): Promise<SendResult>;
  onInbound(handler: InboundHandler): void;
  onStatus(handler: StatusHandler): void;
  health(accountId: string): Promise<{ connected: boolean; detail?: string }>;
  resolveRecipient(identifier: { phone?: string; username?: string }): Promise<{ providerRecipientId: string; providerConversationId: string }>;
}

export interface AdapterRegistry { get(kind:MessengerKind,accountId:string):MessengerAdapter|undefined; all():MessengerAdapter[]; }
export class InMemoryAdapterRegistry implements AdapterRegistry {private readonly values=new Map<string,MessengerAdapter>();register(a:MessengerAdapter){this.values.set(`${a.kind}:${a.accountId}`,a);}remove(kind:MessengerKind,id:string){this.values.delete(`${kind}:${id}`);}get(k:MessengerKind,id:string){return this.values.get(`${k}:${id}`);}all(){return [...this.values.values()];}}
