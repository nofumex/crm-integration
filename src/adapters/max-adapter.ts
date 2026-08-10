import type { InboundHandler, MessengerAdapter, StatusHandler } from "./messenger-adapter.js";
import type { NormalizedMessage, SendMessageCommand, SendResult } from "../domain/messages.js";

interface MaxOptions { token: string; baseUrl?: string; transport?: typeof fetch }

/** Official MAX Bot API adapter. It intentionally does not emulate a personal MAX account. */
export class MaxAdapter implements MessengerAdapter {
  readonly kind = "max" as const;
  private inbound?: InboundHandler;
  private status?: StatusHandler;
  private connected = false;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: MaxOptions) { this.fetcher = options.transport ?? fetch; }
  onInbound(handler: InboundHandler): void { this.inbound = handler; }
  onStatus(handler: StatusHandler): void { this.status = handler; }
  async connect(): Promise<void> { this.connected = true; }
  async disconnect(): Promise<void> { this.connected = false; }
  async health(): Promise<{ connected: boolean; detail: string }> { return { connected: this.connected, detail: "official-bot-api-only" }; }

  async send(command: SendMessageCommand): Promise<SendResult> {
    const base = this.options.baseUrl ?? "https://platform-api2.max.ru";
    const query = new URLSearchParams({ user_id: command.recipientId });
    const response = await this.fetcher(`${base}/messages?${query}`, {
      method: "POST", headers: { Authorization: this.options.token, "Content-Type": "application/json" },
      body: JSON.stringify({ text: command.text ?? "", attachments: [] }),
    });
    if (!response.ok) throw new Error(`MAX Bot API returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const json = await response.json() as any;
    const id = String(json?.body?.mid ?? json?.message?.body?.mid ?? json?.message_id ?? "");
    if (!id) throw new Error("MAX Bot API response has no message id");
    return { externalMessageId: id, status: "sent", occurredAt: new Date() };
  }

  async acceptUpdate(update: any, accountId: string): Promise<void> {
    if (update?.update_type !== "message_created" || !this.inbound) return;
    const msg = update.message;
    const normalized: NormalizedMessage = {
      id: String(msg.body.mid), messenger: "max", accountId,
      conversationId: String(msg.recipient?.chat_id ?? msg.body?.chat_id), direction: "inbound",
      sender: { externalId: String(msg.sender?.user_id), displayName: msg.sender?.name }, text: msg.body?.text,
      attachments: (msg.body?.attachments ?? []).map((a: any) => ({ id: a.payload?.token, kind: a.type === "image" ? "image" : a.type === "video" ? "video" : a.type === "audio" ? "audio" : "file" })),
      occurredAt: unixDate(Number(msg.timestamp ?? update.timestamp)), status: "delivered", raw: update,
    };
    await this.inbound(normalized);
  }
}

function unixDate(value: number): Date { return new Date(value > 1_000_000_000_000 ? value : value * 1000); }
