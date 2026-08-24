import{randomUUID}from"node:crypto";
import type{AccountRepository,MessengerAccount}from"../domain/accounts.js";
import type{MessengerKind}from"../domain/messages.js";
import type{SecretStore}from"../security/secret-store.js";
import{sourceExternalIdForAccount}from"../amocrm/source-reconciliation.js";

export class AccountManagementService{
 constructor(private readonly accounts:AccountRepository,private readonly secrets:SecretStore){}
 async create(input:{id?:string;messenger:MessengerKind;providerAccountId:string;displayName?:string;amoAccountId:string;credentials:Record<string,unknown>;config?:Record<string,unknown>}):Promise<{id:string}>{validate(input);const id=input.id??randomUUID();const credentialRef=`${input.messenger}:${id}`;await this.secrets.put(credentialRef,input.credentials);await this.accounts.upsert({id,messenger:input.messenger,providerAccountId:input.providerAccountId,displayName:input.displayName,credentialRef,amoAccountId:input.amoAccountId,sourceExternalId:sourceExternalIdForAccount(id),config:input.config??{},state:"disconnected"});return{id};}
}
function validate(i:any){if(!["telegram","whatsapp","max"].includes(i.messenger))throw new Error("Unsupported messenger");if(i.messenger==="whatsapp")throw new Error("WhatsApp Personal cannot be configured: Meta has not published a first-party Linked Devices API/SDK");if(i.messenger==="max")throw new Error("MAX Personal cannot be configured: MAX has not published a first-party linked-device API/SDK");if(!i.providerAccountId||!i.amoAccountId)throw new Error("providerAccountId and amoAccountId are required");const c=i.credentials??{};if(i.messenger==="telegram"&&(!Number.isInteger(Number(c.apiId))||!c.apiHash||typeof c.session!=="string"))throw new Error("Telegram credentials require apiId, apiHash and session");}
