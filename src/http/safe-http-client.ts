import { ReadOnlyViolationError } from "../core/errors.js";

export type HttpTransport = (url: string, init: RequestInit) => Promise<Response>;

export interface SafeHttpClientOptions {
  baseUrl: string;
  readOnly?: boolean;
  defaultHeaders?: HeadersInit;
  transport?: HttpTransport;
}

export class SafeHttpClient {
  readonly readOnly: boolean;
  private readonly baseUrl: string;
  private readonly defaultHeaders: HeadersInit;
  private readonly transport: HttpTransport;

  constructor(options: SafeHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.readOnly = options.readOnly ?? true;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.transport = options.transport ?? fetch;
  }

  async request<T>(method: string, path: string, init: RequestInit = {}): Promise<T> {
    const normalizedMethod = method.toUpperCase();
    const url = new URL(path, `${this.baseUrl}/`).toString();

    // The guard deliberately runs before headers/body construction and transport invocation.
    if (this.readOnly && normalizedMethod !== "GET") {
      throw new ReadOnlyViolationError(normalizedMethod, url);
    }

    const response = await this.transport(url, {
      ...init,
      method: normalizedMethod,
      headers: { ...this.defaultHeaders, ...init.headers },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status} ${normalizedMethod} ${url}: ${body.slice(0, 500)}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}
