import { ReadOnlyViolationError } from "../core/errors.js";
import { HttpError } from "./http-error.js";

export type HttpTransport = (url: string, init: RequestInit) => Promise<Response>;

export interface SafeHttpClientOptions {
  baseUrl: string;
  readOnly?: boolean;
  defaultHeaders?: HeadersInit;
  transport?: HttpTransport;
  timeoutMs?:number;
}

export class SafeHttpClient {
  readonly readOnly: boolean;
  private readonly baseUrl: string;
  private readonly defaultHeaders: HeadersInit;
  private readonly transport: HttpTransport;
  private readonly timeoutMs:number;

  constructor(options: SafeHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.readOnly = options.readOnly ?? true;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.transport = options.transport ?? fetch;
    this.timeoutMs=options.timeoutMs??10_000;
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
      signal:init.signal??AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new HttpError(response.status,normalizedMethod,url,parseRetryAfter(response.headers.get("retry-after")),body.slice(0,500));
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

function parseRetryAfter(value:string|null):number|undefined{if(!value)return undefined;const seconds=Number(value);if(Number.isFinite(seconds))return Math.max(0,seconds*1000);const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-Date.now()):undefined;}
