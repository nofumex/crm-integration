import{lookup}from"node:dns/promises";
import{isIP}from"node:net";
import type{AttachmentKind}from"../domain/messages.js";
import{HttpError}from"../http/http-error.js";

export class SafeMediaDownloader{
 constructor(private readonly options:{maxBytes:number;timeoutMs:number;allowedHosts?:string[];transport?:typeof fetch}){}
 async download(urlValue:string):Promise<{data:Buffer;mimeType?:string}>{const url=new URL(urlValue);if(url.protocol!=="https:")throw new Error("Media URL must use HTTPS");await this.validateHost(url.hostname);const response=await(this.options.transport??fetch)(url,{redirect:"error",signal:AbortSignal.timeout(this.options.timeoutMs)});if(!response.ok)throw new HttpError(response.status,"GET",url.origin);const length=Number(response.headers.get("content-length")??0);if(length>this.options.maxBytes)throw new Error("Media exceeds size limit");const reader=response.body?.getReader();if(!reader)throw new Error("Media response has no body");const chunks:Uint8Array[]=[];let size=0;while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>this.options.maxBytes){await reader.cancel();throw new Error("Media exceeds size limit");}chunks.push(value);}return{data:Buffer.concat(chunks.map(x=>Buffer.from(x))),mimeType:response.headers.get("content-type")?.split(";")[0]};}
 private async validateHost(host:string){if(this.options.allowedHosts?.length&&!this.options.allowedHosts.some(h=>host===h||host.endsWith(`.${h}`)))throw new Error("Media host is not allowlisted");if(isIP(host)){if(isPrivate(host))throw new Error("Private media address is forbidden");return;}const addresses=await lookup(host,{all:true});if(!addresses.length||addresses.some(a=>isPrivate(a.address)))throw new Error("Media host resolves to private address");}
}
function isPrivate(ip:string){const v=ip.toLowerCase();if(v==="::1"||v.startsWith("fc")||v.startsWith("fd")||v.startsWith("fe80:"))return true;if(v.startsWith("::ffff:"))return isPrivate(v.slice(7));const p=v.split(".").map(Number);return p.length===4&&(p[0]===10||p[0]===127||p[0]===0||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]!>=16&&p[1]!<=31)||(p[0]===192&&p[1]===168));}
