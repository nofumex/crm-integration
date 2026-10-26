import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {PutObjectCommand,GetObjectCommand,HeadObjectCommand,S3Client} from '@aws-sdk/client-s3';
import type {MediaStore} from './media-store.js';
import type {SafeMediaDownloader} from './safe-downloader.js';
import type {AttachmentKind} from '../domain/messages.js';

export interface MediaScanner {scan(data:Buffer):Promise<void>}
interface MediaOptions {
 client:S3Client;bucket:string;urlTtlSeconds:number;maxBytes:number;
 downloader:SafeMediaDownloader;scanner:MediaScanner;prefix?:string;timeoutMs?:number;
 publicBaseUrl?:string;publicTokenKey?:string;
}
export class S3MediaStore implements MediaStore {
 constructor(private readonly options:MediaOptions) {}
 async put(input:{data:Buffer;kind:AttachmentKind;mimeType?:string;fileName?:string;sourceId:string}) {
  if(input.data.byteLength>this.options.maxBytes)throw new Error('Media exceeds size limit');
  validateMime(input.kind,input.mimeType);
  // Reject malware before configuration/storage checks, including on test and fail-closed paths.
  await this.options.scanner.scan(input.data);
  if(!this.options.publicBaseUrl||!this.options.publicTokenKey)throw new Error('Public HTTPS media gateway is not configured');
  const safeName=sanitize(input.fileName??'media.bin');
  const prefix=(this.options.prefix??'bridge').replace(/[^a-zA-Z0-9/_-]/g,'');
  const key=prefix+'/'+new Date().toISOString().slice(0,10)+'/'+randomUUID()+'-'+safeName;
  // Private MinIO without a KMS cannot accept SSE-S3/AES256. Transport remains private inside Docker.
  await this.options.client.send(new PutObjectCommand({Bucket:this.options.bucket,Key:key,Body:input.data,
   ContentType:input.mimeType??'application/octet-stream',Metadata:{source_hash:Buffer.from(input.sourceId).toString('base64url').slice(0,200)}}),
   {abortSignal:AbortSignal.timeout(this.options.timeoutMs??15000)});
  const expires=Math.floor(Date.now()/1000)+this.options.urlTtlSeconds;
  const encoded=Buffer.from(key).toString('base64url');
  const payload=encoded+'.'+expires;
  const sig=createHmac('sha256',this.options.publicTokenKey).update(payload).digest('base64url');
  const base=this.options.publicBaseUrl.replace(/\/$/,'');
  if(!/^https:\/\//.test(base))throw new Error('Public media gateway must use HTTPS');
  return {url:base+'/media/'+payload+'.'+sig,size:input.data.byteLength,mimeType:input.mimeType,fileName:safeName};
 }
 async ingestRemote(input:{url:string;kind:AttachmentKind;mimeType?:string;fileName?:string;sourceId:string}) {
  const downloaded=await this.options.downloader.download(input.url);
  const uploaded=await this.put({data:downloaded.data,kind:input.kind,mimeType:downloaded.mimeType??input.mimeType,fileName:input.fileName,sourceId:input.sourceId});
  // Telegram must upload bytes itself. Giving Telegram our signed public URL makes
  // messages.SendMedia ask Telegram servers to fetch the webpage, which fails.
  // This buffer exists only in this worker invocation and is bounded by maxBytes.
  return {...uploaded,uploadBytes:downloaded.data};
 }
 private checkToken(token:string):string {
  if(!this.options.publicTokenKey||token.length>1024)throw new Error('Invalid media token');
  const pieces=token.split('.');if(pieces.length!==3||!/^[A-Za-z0-9_-]+$/.test(pieces[0]??'')||!/^\d{10}$/.test(pieces[1]??'')||!(/^[A-Za-z0-9_-]+$/.test(pieces[2]??'')))throw new Error('Invalid media token');
  const exp=Number(pieces[1]);if(exp<=Math.floor(Date.now()/1000)||exp>Date.now()/1000+7*24*3600)throw new Error('Invalid media token');
  // Compare the canonical encoded signature itself: decoding base64url can normalize
  // distinct trailing characters to the same bytes when unused pad bits differ.
  const expected=Buffer.from(createHmac('sha256',this.options.publicTokenKey).update(pieces[0]+'.'+pieces[1]).digest('base64url'),'ascii');
  const supplied=Buffer.from(pieces[2]!,'ascii');
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw new Error('Invalid media token');
  const key=Buffer.from(pieces[0]!,'base64url').toString('utf8');
  if(key.length>500||!/^bridge\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}-[a-zA-Z0-9._-]+$/.test(key))throw new Error('Invalid media token');
  return key;
 }
 async openPublicToken(token:string,range?:string):Promise<{body:unknown;contentType:string;contentLength?:number;contentRange?:string;partial:boolean}> {
  const key=this.checkToken(token);
  if(range&&(!/^bytes=\d+-\d*$/.test(range)||range.length>60))throw new Error('Invalid media range');
  const obj=await this.options.client.send(new GetObjectCommand({Bucket:this.options.bucket,Key:key,...(range?{Range:range}:{})}));
  if(!obj.Body)throw new Error('Media response has no body');
  return {body:obj.Body,contentType:obj.ContentType??'application/octet-stream',contentLength:obj.ContentLength,contentRange:obj.ContentRange,partial:Boolean(range)};
 }
 async headPublicToken(token:string):Promise<{contentType:string;contentLength?:number}> {
  const key=this.checkToken(token);
  const obj=await this.options.client.send(new HeadObjectCommand({Bucket:this.options.bucket,Key:key}));
  return {contentType:obj.ContentType??'application/octet-stream',contentLength:obj.ContentLength};
 }
}
function sanitize(name:string){return name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120)||'media.bin';}
function validateMime(kind:AttachmentKind,mime?:string){if(!mime)return;const allowed:Record<AttachmentKind,string[]>={image:['image/'],video:['video/'],audio:['audio/'],voice:['audio/'],file:['application/','text/','image/','audio/','video/'],sticker:['image/','application/x-tgsticker'],unknown:['application/','text/','image/','audio/','video/']};if(!allowed[kind].some(p=>mime.startsWith(p)))throw new Error('Unexpected MIME type for '+kind);}
