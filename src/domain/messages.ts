export type MessengerKind = "telegram" | "whatsapp" | "max";
export type MessageDirection = "inbound" | "outbound";
export type MessageStatus = "queued" | "sent" | "delivered" | "read" | "failed" | "delivery_unknown";
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
  /** Safe Telegram peer data needed to address this user after an adapter restart. */
  recipientReference?: TelegramRecipientReference;
  /** Encrypted SecretStore key containing recipientReference; safe to put in a job. */
  recipientSecretRef?: string;
  /** Safe, provider-supplied profile fields. This is never an MTProto session. */
  profile?: TelegramProfile;
}

export interface TelegramRecipientReference {
  kind: "telegram_input_peer_user";
  userId: string;
  accessHash: string;
}

export interface TelegramProfile {
  telegramId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  phone?: string;
  isBot?: boolean;
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
  recipientReference?: TelegramRecipientReference;
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
