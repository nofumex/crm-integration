import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SafeHttpClient, type HttpTransport } from "../http/safe-http-client.js";

export interface AmoChatsClientOptions {
  baseUrl?: string;
  channelId: string;
  channelSecret: string;
  readOnly?: boolean;
  transport?: HttpTransport;
  now?: () => Date;
}

export class AmoCrmChatsClient {
  private readonly http: SafeHttpClient;
  private readonly channelId: string;
  private readonly secret: string;
  private readonly now: () => Date;

  constructor(options: AmoChatsClientOptions) {
    this.channelId = options.channelId;
    this.secret = options.channelSecret;
    this.now = options.now ?? (() => new Date());
    this.http = new SafeHttpClient({
      baseUrl: options.baseUrl ?? "https://amojo.amocrm.ru",
      readOnly: options.readOnly ?? true,
      transport: options.transport,
    });
  }

  private async signed<T>(method: string, path: string, body?: unknown): Promise<T> {
    const rawBody = body === undefined ? "" : JSON.stringify(body);
    const date = this.now().toUTCString();
    const contentType = "application/json";
    const md5 = createHash("md5").update(rawBody).digest("hex");
    const signingInput = [method.toUpperCase(), md5, contentType, date, path].join("\n");
    const signature = createHmac("sha1", this.secret).update(signingInput).digest("hex");
    return this.http.request<T>(method, path, {
      headers: { Date: date, "Content-Type": contentType, "Content-MD5": md5, "X-Signature": signature },
      ...(body === undefined ? {} : { body: rawBody }),
    });
  }

  connectChannel(accountId: string, title?: string): Promise<unknown> {
    return this.signed("POST", `/v2/origin/custom/${this.channelId}/connect`, {
      account_id: accountId,
      hook_api_version: "v2",
      ...(title ? { title } : {}),
    });
  }

  createChat(scopeId: string, body: unknown): Promise<unknown> {
    return this.signed("POST", `/v2/origin/custom/${scopeId}/chats`, body);
  }

  sendMessage(scopeId: string, body: unknown): Promise<unknown> {
    return this.signed("POST", `/v2/origin/custom/${scopeId}`, body);
  }

  updateDeliveryStatus(scopeId: string, messageId: string, body: unknown): Promise<void> {
    return this.signed("POST", `/v2/origin/custom/${scopeId}/${messageId}/delivery_status`, body);
  }

  getHistory(scopeId: string, conversationId: string): Promise<unknown> {
    return this.signed("GET", `/v2/origin/custom/${scopeId}/chats/${conversationId}/history`);
  }
}

export function verifyAmoWebhookSignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha1", secret).update(rawBody).digest("hex");
  const received = signature.toLowerCase();
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
