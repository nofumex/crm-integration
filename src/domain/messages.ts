export type MessengerKind = "telegram" | "whatsapp" | "max";
export type MessageDirection = "inbound" | "outbound";
export type MessageStatus = "queued" | "sent" | "delivered" | "read" | "failed";
export type AttachmentKind = "image" | "video" | "audio" | "voice" | "file" | "sticker" | "unknown";

export interface NormalizedAttachment {
  id?: string;
  kind: AttachmentKind;
  url?: string;
  mimeType?: string;
  fileName?: string;
  size?: number;
  caption?: string;
}

export interface NormalizedParticipant {
  externalId: string;
  displayName?: string;
  phone?: string;
  username?: string;
  avatarUrl?: string;
}

export interface NormalizedMessage {
  id: string;
  messenger: MessengerKind;
  accountId: string;
  conversationId: string;
  direction: MessageDirection;
  sender: NormalizedParticipant;
  recipient?: NormalizedParticipant;
  text?: string;
  attachments: NormalizedAttachment[];
  replyToId?: string;
  mediaGroupId?: string;
  occurredAt: Date;
  status: MessageStatus;
  raw?: unknown;
}

export interface SendMessageCommand {
  accountId: string;
  conversationId: string;
  recipientId: string;
  text?: string;
  attachments?: NormalizedAttachment[];
  idempotencyKey: string;
  replyToId?: string;
}

export interface SendResult {
  externalMessageId: string;
  status: MessageStatus;
  occurredAt: Date;
}
