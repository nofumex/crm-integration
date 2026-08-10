import type { SecretStore } from "../security/secret-store.js";
import { HttpError } from "../http/http-error.js";
import { ReadOnlyViolationError } from "../core/errors.js";

interface StoredTokens extends Record<string,unknown>{accessToken:string;refreshToken:string;expiresAt:number}
export class RefreshingAmoTokenProvider{
 private refreshing?:Promise<string>;
 constructor(private readonly options:{baseUrl:string;integrationId:string;clientSecret:string;redirectUri:string;credentialRef:string;secrets:SecretStore;writesAllowed:boolean;transport?:typeof fetch;now?:()=>number}){}
 async getAccessToken():Promise<string>{const tokens=await this.required();if(tokens.expiresAt>(this.options.now?.()??Date.now())+60_000)return tokens.accessToken;if(!this.options.writesAllowed)throw new ReadOnlyViolationError("POST",new URL("/oauth2/access_token",this.options.baseUrl).toString());return this.refreshing??=(this.refresh(tokens).finally(()=>{this.refreshing=undefined;}));}
 private async refresh(tokens:StoredTokens):Promise<string>{const url=new URL("/oauth2/access_token",this.options.baseUrl).toString();const response=await(this.options.transport??fetch)(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({client_id:this.options.integrationId,client_secret:this.options.clientSecret,grant_type:"refresh_token",refresh_token:tokens.refreshToken,redirect_uri:this.options.redirectUri}),signal:AbortSignal.timeout(10_000)});if(!response.ok)throw new HttpError(response.status,"POST",url);const body=await response.json() as any;if(!body.access_token||!body.refresh_token||!body.expires_in)throw new Error("Invalid amoCRM OAuth refresh response");const next:StoredTokens={accessToken:String(body.access_token),refreshToken:String(body.refresh_token),expiresAt:(this.options.now?.()??Date.now())+Number(body.expires_in)*1000};await this.options.secrets.put(this.options.credentialRef,next);return next.accessToken;}
 private async required(){const value=await this.options.secrets.get<StoredTokens>(this.options.credentialRef);if(!value)throw new Error(`amoCRM OAuth secret ${this.options.credentialRef} is missing`);return value;}
}
