import { SafeHttpClient, type HttpTransport } from "../http/safe-http-client.js";

export interface AmoRestClientOptions {
  baseUrl: string;
  accessToken: string;
  readOnly?: boolean;
  transport?: HttpTransport;
}

export class AmoCrmRestClient {
  private readonly http: SafeHttpClient;

  constructor(options: AmoRestClientOptions) {
    this.http = new SafeHttpClient({
      baseUrl: options.baseUrl,
      readOnly: options.readOnly ?? true,
      transport: options.transport,
      defaultHeaders: {
        Authorization: `Bearer ${options.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  }

  getAccountWithAmojoId(): Promise<unknown> {
    return this.http.request("GET", "/api/v4/account?with=amojo_id");
  }

  getUsersWithAmojoId(limit = 50): Promise<unknown> {
    return this.http.request("GET", `/api/v4/users?with=amojo_id&limit=${limit}`);
  }

  getPipelines(limit = 50): Promise<unknown> {
    return this.http.request("GET", `/api/v4/leads/pipelines?limit=${limit}`);
  }

  getSources(limit = 50): Promise<unknown> {
    return this.http.request("GET", `/api/v4/sources?limit=${limit}`);
  }

  linkChatToContact(contactId: number, chatId: string): Promise<unknown> {
    return this.http.request("POST", "/api/v4/contacts/chats", {
      body: JSON.stringify([{ contact_id: contactId, chat_id: chatId }]),
    });
  }

  patchContact(contactId: number, patch: unknown): Promise<unknown> {
    return this.http.request("PATCH", `/api/v4/contacts/${contactId}`, { body: JSON.stringify(patch) });
  }

  deleteSource(sourceId: number): Promise<void> {
    return this.http.request("DELETE", `/api/v4/sources/${sourceId}`);
  }
}
