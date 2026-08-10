import{randomUUID}from"node:crypto";
import type{AccountRepository,MessengerAccount}from"../domain/accounts.js";
import type{MessengerKind}from"../domain/messages.js";
import type{SecretStore}from"../security/secret-store.js";

export class AccountManagementService{
 constructor(private readonly accounts:AccountRepository,private readonly secrets:SecretStore){}
 async create(input:{id?:string;messenger:MessengerKind;providerAccountId:string;displayName?:string;amoAccountId:string;sourceExternalId:string;credentials:Record<string,unknown>;config?:Record<string,unknown>}):Promise<{id:string}>{validate(input);const id=input.id??randomUUID();const credentialRef=`${input.messenger}:${id}`;await this.secrets.put(credentialRef,input.credentials);await this.accounts.upsert({id,messenger:input.messenger,providerAccountId:input.providerAccountId,displayName:input.displayName,credentialRef,amoAccountId:input.amoAccountId,sourceExternalId:input.sourceExternalId,config:input.config??{},state:"disconnected"});return{id};}
}
function validate(i:any){if(!["telegram","whatsapp","max"].includes(i.messenger))throw new Error("Unsupported messenger");if(!i.providerAccountId||!i.amoAccountId||!i.sourceExternalId)throw new Error("providerAccountId, amoAccountId and sourceExternalId are required");if(i.sourceExternalId.length>36)throw new Error("sourceExternalId exceeds amoCRM limit");const c=i.credentials??{};if(i.messenger==="telegram"&&(!Number.isInteger(Number(c.apiId))||!c.apiHash||typeof c.session!=="string"))throw new Error("Telegram credentials require apiId, apiHash and session");if(i.messenger==="whatsapp"&&(!c.accessToken||!c.phoneNumberId||!c.graphVersion||!c.appSecret))throw new Error("WhatsApp credentials incomplete");if(i.messenger==="max"&&typeof c.session!=="string")throw new Error("MAX Personal requires a linked-device session issued by an approved Partner API/SDK");}
