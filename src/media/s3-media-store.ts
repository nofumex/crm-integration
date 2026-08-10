import{randomUUID}from"node:crypto";
import{PutObjectCommand,S3Client}from"@aws-sdk/client-s3";
import{getSignedUrl}from"@aws-sdk/s3-request-presigner";
import{GetObjectCommand}from"@aws-sdk/client-s3";
import type{MediaStore}from"./media-store.js";
import type{SafeMediaDownloader}from"./safe-downloader.js";
import type{AttachmentKind}from"../domain/messages.js";

export interface MediaScanner{scan(data:Buffer):Promise<void>}
export class S3MediaStore implements MediaStore{
 constructor(private readonly options:{client:S3Client;bucket:string;urlTtlSeconds:number;maxBytes:number;downloader:SafeMediaDownloader;scanner:MediaScanner;prefix?:string}){}
 async put(input:{data:Buffer;kind:AttachmentKind;mimeType?:string;fileName?:string;sourceId:string}){if(input.data.byteLength>this.options.maxBytes)throw new Error("Media exceeds size limit");validateMime(input.kind,input.mimeType);await this.options.scanner.scan(input.data);const safeName=sanitize(input.fileName??"media.bin");const key=`${this.options.prefix??"bridge"}/${new Date().toISOString().slice(0,10)}/${randomUUID()}-${safeName}`;await this.options.client.send(new PutObjectCommand({Bucket:this.options.bucket,Key:key,Body:input.data,ContentType:input.mimeType??"application/octet-stream",ServerSideEncryption:"AES256",Metadata:{source_hash:Buffer.from(input.sourceId).toString("base64url").slice(0,200)}}));const url=await getSignedUrl(this.options.client,new GetObjectCommand({Bucket:this.options.bucket,Key:key}),{expiresIn:this.options.urlTtlSeconds});return{url,size:input.data.byteLength,mimeType:input.mimeType,fileName:safeName};}
 async ingestRemote(input:{url:string;kind:AttachmentKind;mimeType?:string;fileName?:string;sourceId:string}){const downloaded=await this.options.downloader.download(input.url);return this.put({data:downloaded.data,kind:input.kind,mimeType:downloaded.mimeType??input.mimeType,fileName:input.fileName,sourceId:input.sourceId});}
}
function sanitize(name:string){return name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-120)||"media.bin";}
function validateMime(kind:AttachmentKind,mime?:string){if(!mime)return;const allowed:Record<AttachmentKind,string[]>={image:["image/"],video:["video/"],audio:["audio/"],voice:["audio/"],file:["application/","text/","image/","audio/","video/"],sticker:["image/","application/x-tgsticker"],unknown:["application/","text/","image/","audio/","video/"]};if(!allowed[kind].some(p=>mime.startsWith(p)))throw new Error(`Unexpected MIME type for ${kind}`);}
