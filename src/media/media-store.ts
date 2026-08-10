import type{AttachmentKind}from"../domain/messages.js";
export interface MediaStore{
 put(input:{data:Buffer;kind:AttachmentKind;mimeType?:string;fileName?:string;sourceId:string}):Promise<{url:string;size:number;mimeType?:string;fileName?:string}>;
 ingestRemote(input:{url:string;kind:AttachmentKind;mimeType?:string;fileName?:string;sourceId:string}):Promise<{url:string;size:number;mimeType?:string;fileName?:string}>;
}
