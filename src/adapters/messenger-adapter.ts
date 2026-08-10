import type { MessengerKind, NormalizedMessage, SendMessageCommand, SendResult } from "../domain/messages.js";

export type InboundHandler = (message: NormalizedMessage) => Promise<void>;
export type StatusHandler = (accountId: string, externalMessageId: string, status: SendResult["status"], occurredAt: Date) => Promise<void>;

export interface MessengerAdapter {
  readonly kind: MessengerKind;
  connect(accountId: string): Promise<void>;
  disconnect(accountId: string): Promise<void>;
  send(command: SendMessageCommand): Promise<SendResult>;
  onInbound(handler: InboundHandler): void;
  onStatus(handler: StatusHandler): void;
  health(accountId: string): Promise<{ connected: boolean; detail?: string }>;
}
