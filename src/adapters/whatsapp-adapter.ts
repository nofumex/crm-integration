import { createHmac, timingSafeEqual } from "node:crypto";
import type { InboundHandler, MessengerAdapter, StatusHandler } from "./messenger-adapter.js";
import type { NormalizedAttachment, NormalizedMessage, SendMessageCommand, SendResult } from "../domain/messages.js";
import type { MediaStore } from "../media/media-store.js";

interface WhatsAppOptions {
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
  appSecret?: string;
  transport?: typeof fetch;
  mediaStore?: MediaStore;
}

export class WhatsAppAdapter implements MessengerAdapter {
  readonly kind = "whatsapp" as const;
  private inbound?: InboundHandler;
  private status?: StatusHandler;
  private connected = false;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: WhatsAppOptions) {
    this.fetcher = options.transport ?? fetch;
  }

  async connect(): Promise<void> { this.connected = true; }
  async disconnect(): Promise<void> { this.connected = false; }
  onInbound(handler: InboundHandler): void { this.inbound = handler; }
  onStatus(handler: StatusHandler): void { this.status = handler; }
  async health(): Promise<{ connected: boolean }> { return { connected: this.connected }; }

  async send(command: SendMessageCommand): Promise<SendResult> {
    const attachment = command.attachments?.[0];
    const body = attachment
      ? this.mediaPayload(command.recipientId, attachment, command.text)
      : { messaging_product: "whatsapp", recipient_type: "individual", to: command.recipientId, type: "text", text: { body: command.text ?? "" } };
    const version = this.options.graphVersion;
    const response = await this.fetcher(`https://graph.facebook.com/${version}/${this.options.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`WhatsApp Cloud API returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const json = await response.json() as { messages?: Array<{ id: string }> };
    const id = json.messages?.[0]?.id;
    if (!id) throw new Error("WhatsApp Cloud API response has no message id");
    return { externalMessageId: id, status: "sent", occurredAt: new Date() };
  }

  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    if (!this.options.appSecret || !signature?.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", this.options.appSecret).update(rawBody).digest("hex");
    const received = signature.slice(7).toLowerCase();
    return received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  }

  async acceptWebhook(payload: any): Promise<void> {
    for (const entry of payload?.entry ?? []) for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const accountId = value?.metadata?.phone_number_id;
      for (const item of value?.messages ?? []) {
        const attachments = await this.parseAttachments(item);
        const message: NormalizedMessage = {
          id: item.id, messenger: "whatsapp", accountId, conversationId: item.from,
          direction: "inbound", sender: { externalId: item.from, displayName: value?.contacts?.[0]?.profile?.name, phone: item.from },
          text: item.text?.body ?? item.image?.caption ?? item.video?.caption ?? item.document?.caption,
          attachments, occurredAt: new Date(Number(item.timestamp) * 1000), status: "delivered", raw: item,
        };
        if (this.inbound) await this.inbound(message);
      }
      for (const item of value?.statuses ?? []) {
        const mapped = item.status === "read" ? "read" : item.status === "delivered" ? "delivered" : item.status === "failed" ? "failed" : "sent";
        if (this.status) await this.status(accountId, item.id, mapped, new Date(Number(item.timestamp) * 1000));
      }
    }
  }

  private mediaPayload(to: string, attachment: NormalizedAttachment, caption?: string): unknown {
    const type = attachment.kind === "image" || attachment.kind === "video" || attachment.kind === "audio" ? attachment.kind : "document";
    const media = attachment.id ? { id: attachment.id } : { link: attachment.url };
    return { messaging_product: "whatsapp", recipient_type: "individual", to, type, [type]: { ...media, ...(caption ? { caption } : {}), ...(attachment.fileName ? { filename: attachment.fileName } : {}) } };
  }

  private async parseAttachments(item: any): Promise<NormalizedAttachment[]> {
    for (const type of ["image", "video", "audio", "document", "sticker"] as const) {
      if (item[type]) {
        const attachment: NormalizedAttachment = { id: item[type].id, kind: type === "document" ? "file" : type, mimeType: item[type].mime_type, fileName: item[type].filename, caption: item[type].caption };
        if (this.options.mediaStore && attachment.id) {
          const version = this.options.graphVersion;
          const metaResponse = await this.fetcher(`https://graph.facebook.com/${version}/${attachment.id}`, { headers: { Authorization: `Bearer ${this.options.accessToken}` } });
          if (!metaResponse.ok) throw new Error(`Could not resolve WhatsApp media ${attachment.id}`);
          const meta = await metaResponse.json() as { url: string; mime_type?: string; file_size?: number };
          const mediaResponse = await this.fetcher(meta.url, { headers: { Authorization: `Bearer ${this.options.accessToken}` } });
          if (!mediaResponse.ok) throw new Error(`Could not download WhatsApp media ${attachment.id}`);
          const published = await this.options.mediaStore.put({ data: Buffer.from(await mediaResponse.arrayBuffer()), kind: attachment.kind, mimeType: meta.mime_type ?? attachment.mimeType, fileName: attachment.fileName, sourceId: attachment.id });
          attachment.url = published.url; attachment.size = published.size;
        }
        return [attachment];
      }
    }
    return [];
  }
}
