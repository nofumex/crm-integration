import { SafeHttpClient, type HttpTransport } from "../http/safe-http-client.js";
import { ReadOnlyViolationError } from "../core/errors.js";

export interface AmoRestClientOptions {
  baseUrl: string;
  accessToken?: string;
  tokenProvider?: {getAccessToken():Promise<string>};
  readOnly?: boolean;
  transport?: HttpTransport;
}

export class AmoCrmRestClient {
  private readonly http: SafeHttpClient;
  private readonly tokenProvider:{getAccessToken():Promise<string>};
  private readonly readOnly:boolean;
  private readonly baseUrl:string;

  constructor(options: AmoRestClientOptions) {
    if(!options.accessToken&&!options.tokenProvider)throw new Error("amoCRM access token provider is required");
    this.readOnly=options.readOnly??true;this.baseUrl=options.baseUrl;
    this.tokenProvider=options.tokenProvider??{getAccessToken:async()=>options.accessToken!};
    this.http = new SafeHttpClient({
      baseUrl: options.baseUrl,
      readOnly: options.readOnly ?? true,
      transport: options.transport,
      defaultHeaders: { Accept: "application/json", "Content-Type": "application/json" },
    });
  }

  getAccountWithAmojoId(): Promise<unknown> {
    return this.request("GET", "/api/v4/account?with=amojo_id");
  }

  getUsersWithAmojoId(limit = 50): Promise<unknown> {
    return this.request("GET", `/api/v4/users?with=amojo_id&limit=${limit}`);
  }

  getPipelines(limit = 50): Promise<unknown> {
    return this.request("GET", `/api/v4/leads/pipelines?limit=${limit}`);
  }

  getSources(limit = 50): Promise<unknown> {
    return this.request("GET", `/api/v4/sources?limit=${limit}`);
  }
  searchContacts(query:string):Promise<any>{return this.request("GET",`/api/v4/contacts?query=${encodeURIComponent(query)}&with=leads&limit=50`);}
  getContactChats(contactId:number):Promise<any>{return this.request("GET",`/api/v4/contacts/chats?contact_id[]=${contactId}`);}
  findSources(externalId:string):Promise<any>{return this.request("GET",`/api/v4/sources?filter[external_id][]=${encodeURIComponent(externalId)}`);}
  createSources(sources:Array<{name:string;external_id:string;pipeline_id?:number;default?:boolean;services?:unknown[]}>):Promise<any>{return this.request("POST","/api/v4/sources",sources);}

  linkChatToContact(contactId: number, chatId: string): Promise<unknown> {
    return this.request("POST", "/api/v4/contacts/chats", [{ contact_id: contactId, chat_id: chatId }]);
  }

  patchContact(contactId: number, patch: unknown): Promise<unknown> {
    return this.request("PATCH", `/api/v4/contacts/${contactId}`, patch);
  }

  deleteSource(sourceId: number): Promise<void> {
    return this.request("DELETE", `/api/v4/sources/${sourceId}`);
  }
  private async request<T>(method:string,path:string,body?:unknown):Promise<T>{if(this.readOnly&&method.toUpperCase()!=="GET")throw new ReadOnlyViolationError(method,new URL(path,`${this.baseUrl.replace(/\/$/,"")}/`).toString());const token=await this.tokenProvider.getAccessToken();return this.http.request<T>(method,path,{headers:{Authorization:`Bearer ${token}`},...(body===undefined?{}:{body:JSON.stringify(body)})});}
}
