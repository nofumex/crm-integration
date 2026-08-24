import type { TelegramRecipientReference } from "../domain/messages.js";
import type { SecretStore } from "../security/secret-store.js";

export function telegramPeerSecretRef(accountId:string,userId:string){return `telegram-peer:${accountId}:${userId}`;}

export async function storeTelegramPeer(secrets:SecretStore,accountId:string,reference:TelegramRecipientReference):Promise<string>{
 const ref=telegramPeerSecretRef(accountId,reference.userId);
 await secrets.put(ref,{kind:reference.kind,userId:reference.userId,accessHash:reference.accessHash});
 return ref;
}

export async function getTelegramPeer(secrets:SecretStore,ref:string):Promise<TelegramRecipientReference|undefined>{
 const value=await secrets.get<TelegramRecipientReference&Record<string,unknown>>(ref);
 return value?.kind==="telegram_input_peer_user"&&typeof value.userId==="string"&&typeof value.accessHash==="string"?value:undefined;
}
