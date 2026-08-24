import type { AmoCrmRestClient } from "./rest-client.js";
import type { AmoCrmChatsClient } from "./chats-client.js";
import type { MessengerAccount } from "../domain/accounts.js";
import type { NormalizedParticipant } from "../domain/messages.js";

export interface ResolvedContact { contactId:number;leadId?:number;contact?:any; }
export class ContactChatResolver {
 constructor(private readonly rest:AmoCrmRestClient,private readonly chats:AmoCrmChatsClient,private readonly fields:{telegramUsernameFieldId?:number;telegramIdFieldId?:number}={}){}
 async findExactByPhone(phone:string):Promise<ResolvedContact|undefined>{const normalized=digits(phone);if(!normalized)return undefined;const result=await this.rest.searchContacts(phone);for(const contact of result?._embedded?.contacts??[]){const phones=phoneValues(contact).map((v:any)=>digits(String(v.value)));if(phones.some((p:string)=>p===normalized)){return{contactId:Number(contact.id),leadId:contact._embedded?.leads?.[0]?.id?Number(contact._embedded.leads[0].id):undefined,contact};}}return undefined;}
 async findExactByTelegramId(telegramId:string):Promise<ResolvedContact|undefined>{if(!this.fields.telegramIdFieldId||!telegramId)return undefined;const result=await this.rest.findContactsByCustomField(this.fields.telegramIdFieldId,telegramId);for(const contact of result?._embedded?.contacts??[]){const field=(contact.custom_fields_values??[]).find((value:any)=>Number(value.field_id)===this.fields.telegramIdFieldId);if((field?.values??[]).some((value:any)=>String(value.value)===telegramId))return{contactId:Number(contact.id),leadId:contact._embedded?.leads?.[0]?.id?Number(contact._embedded.leads[0].id):undefined,contact};}return undefined;}
 async ensureContact(participant:NormalizedParticipant):Promise<ResolvedContact>{
  const phone=participant.phone??participant.profile?.phone;
  if(phone){const existing=await this.findExactByPhone(phone);if(existing){await this.enrich(existing,participant);return existing;}}
  const response:any=await this.rest.createContact(contactPatch(participant,undefined,this.fields));
  const contact=(response?._embedded?.contacts??response?.contacts??[])[0];
  if(!contact?.id)throw new Error("amoCRM create contact response has no id");
  return {contactId:Number(contact.id),leadId:contact._embedded?.leads?.[0]?.id?Number(contact._embedded.leads[0].id):undefined,contact};
 }
 async createChatAndLink(account:MessengerAccount,providerConversationId:string,participant:NormalizedParticipant,contact:ResolvedContact):Promise<{amoConversationId:string;contactId:number}>{if(!account.amoScopeId)throw new Error(`Account ${account.id} has no amoCRM scope`);const response:any=await this.chats.createChat(account.amoScopeId,{conversation_id:providerConversationId,source:{external_id:account.sourceExternalId},user:chatUser(participant)});if(!response?.id)throw new Error("amoCRM create chat response has no id");await this.rest.linkChatToContact(contact.contactId,response.id);await this.enrich(contact,participant);return{amoConversationId:String(response.id),contactId:contact.contactId};}
 async enrich(contact:ResolvedContact|number,participant:NormalizedParticipant):Promise<void>{const contactId=typeof contact==="number"?contact:contact.contactId;const existing=typeof contact==="number"?await this.rest.getContact(contactId):contact.contact;await this.rest.patchContact(contactId,contactPatch(participant,existing,this.fields));}
 async getLinkedLeadId(contactId:number):Promise<number|undefined>{const contact:any=await this.rest.getContact(contactId);const leadId=contact?._embedded?.leads?.[0]?.id;return leadId===undefined?undefined:Number(leadId);}
}
function digits(v:string){return v.replace(/\D/g,"");}
function phoneValues(contact:any){return(contact?.custom_fields_values??[]).filter((f:any)=>f.field_code==="PHONE").flatMap((f:any)=>f.values??[]);}
function contactPatch(participant:NormalizedParticipant,existing:any,fields:{telegramUsernameFieldId?:number;telegramIdFieldId?:number}){const custom:any[]=[];const phone=participant.phone??participant.profile?.phone,username=participant.username??participant.profile?.username;const phones=phoneValues(existing);if(phone&&!phones.some((v:any)=>digits(String(v.value))===digits(phone)))custom.push({field_code:"PHONE",values:[...phones,{value:phone}]});if(fields.telegramUsernameFieldId&&username)custom.push({field_id:fields.telegramUsernameFieldId,values:[{value:username}]});if(fields.telegramIdFieldId)custom.push({field_id:fields.telegramIdFieldId,values:[{value:participant.profile?.telegramId??participant.externalId}]});const firstName=participant.profile?.firstName,lastName=participant.profile?.lastName;return{name:displayName(participant),...(firstName?{first_name:firstName}:{}),...(lastName?{last_name:lastName}:{}),...(custom.length?{custom_fields_values:custom}:{})};}
function displayName(p:NormalizedParticipant){return[p.profile?.firstName,p.profile?.lastName].filter(Boolean).join(" ")||p.username||p.profile?.username||p.profile?.telegramId||p.externalId;}
function chatUser(p:NormalizedParticipant){const phone=p.phone??p.profile?.phone,username=p.username??p.profile?.username;return{id:p.externalId,name:displayName(p),...(p.avatarUrl?{avatar:p.avatarUrl}:{}),...(phone?{profile:{phone}}:{}),...(username?{profile_link:`https://t.me/${username.replace(/^@/,"")}`}:{})};}
