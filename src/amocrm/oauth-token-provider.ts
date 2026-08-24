import type { SecretStore } from "../security/secret-store.js";
import { HttpError } from "../http/http-error.js";
import { ReadOnlyViolationError } from "../core/errors.js";

interface StoredTokens extends Record<string,unknown>{accessToken:string;refreshToken:string;expiresAt:number}
export interface AmoOAuthOptions {baseUrl:string;integrationId:string;clientSecret:string;redirectUri:string;credentialRef:string;secrets:SecretStore;writesAllowed:boolean;transport?:typeof fetch;now?:()=>number}

export async function exchangeAmoAuthorizationCode(options:AmoOAuthOptions,code:string):Promise<void>{
 const url=new URL("/oauth2/access_token",options.baseUrl).toString();
 const response=await(options.transport??fetch)(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({client_id:options.integrationId,client_secret:options.clientSecret,grant_type:"authorization_code",code,redirect_uri:options.redirectUri}),signal:AbortSignal.timeout(10_000)});
 if(!response.ok)throw new HttpError(response.status,"POST",url);
 await storeTokens(options,await response.json());
}

export class RefreshingAmoTokenProvider{
 private refreshing?:Promise<string>;
 constructor(private readonly options:AmoOAuthOptions){}
 async getAccessToken():Promise<string>{const tokens=await this.required();if(tokens.expiresAt>(this.options.now?.()??Date.now())+60_000)return tokens.accessToken;if(!this.options.writesAllowed)throw new ReadOnlyViolationError("POST",new URL("/oauth2/access_token",this.options.baseUrl).toString());return this.refreshing??=(this.refresh(tokens).finally(()=>{this.refreshing=undefined;}));}
 private async refresh(tokens:StoredTokens):Promise<string>{const url=new URL("/oauth2/access_token",this.options.baseUrl).toString();const response=await(this.options.transport??fetch)(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({client_id:this.options.integrationId,client_secret:this.options.clientSecret,grant_type:"refresh_token",refresh_token:tokens.refreshToken,redirect_uri:this.options.redirectUri}),signal:AbortSignal.timeout(10_000)});if(!response.ok)throw new HttpError(response.status,"POST",url);return(await storeTokens(this.options,await response.json())).accessToken;}
 private async required(){const value=await this.options.secrets.get<StoredTokens>(this.options.credentialRef);if(!value)throw new Error(`amoCRM OAuth secret ${this.options.credentialRef} is missing`);return value;}
}

async function storeTokens(options:AmoOAuthOptions,body:unknown):Promise<StoredTokens>{const value=body as any;if(!value?.access_token||!value?.refresh_token||!value?.expires_in)throw new Error("Invalid amoCRM OAuth token response");const expiresIn=Number(value.expires_in);if(!Number.isFinite(expiresIn)||expiresIn<=0)throw new Error("Invalid amoCRM OAuth token response");const next:StoredTokens={accessToken:String(value.access_token),refreshToken:String(value.refresh_token),expiresAt:(options.now?.()??Date.now())+expiresIn*1000};await options.secrets.put(options.credentialRef,next);return next;}
