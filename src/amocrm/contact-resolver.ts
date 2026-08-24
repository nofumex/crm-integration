import type { AmoCrmRestClient } from "./rest-client.js";
import type { AmoCrmChatsClient } from "./chats-client.js";
import type { MessengerAccount } from "../domain/accounts.js";
import type { NormalizedParticipant } from "../domain/messages.js";

export interface ResolvedContact { contactId:number;leadId?:number; }
export class ContactChatResolver {
 constructor(private readonly rest:AmoCrmRestClient,private readonly chats:AmoCrmChatsClient){}
 async findExactByPhone(phone:string):Promise<ResolvedContact|undefined>{const normalized=digits(phone);if(!normalized)return undefined;const result=await this.rest.searchContacts(phone);for(const contact of result?._embedded?.contacts??[]){const phones=(contact.custom_fields_values??[]).filter((f:any)=>f.field_code==="PHONE").flatMap((f:any)=>f.values??[]).map((v:any)=>digits(String(v.value)));if(phones.some((p:string)=>p===normalized)){return{contactId:Number(contact.id),leadId:contact._embedded?.leads?.[0]?.id?Number(contact._embedded.leads[0].id):undefined};}}return undefined;}
 async createChatAndLink(account:MessengerAccount,providerConversationId:string,participant:NormalizedParticipant,contact:ResolvedContact):Promise<{amoConversationId:string}>{if(!account.amoScopeId)throw new Error(`Account ${account.id} has no amoCRM scope`);const response:any=await this.chats.createChat(account.amoScopeId,{conversation_id:providerConversationId,user:{id:participant.externalId,name:participant.displayName??participant.username??participant.externalId,...(participant.avatarUrl?{avatar:participant.avatarUrl}:{}),...(participant.phone?{profile:{phone:participant.phone}}:{})}});if(!response?.id)throw new Error("amoCRM create chat response has no id");await this.rest.linkChatToContact(contact.contactId,response.id);return{amoConversationId:String(response.id)};}
}
function digits(v:string){return v.replace(/\D/g,"");}
