import type { MessageDirection, MessageStatus, MessengerKind, TelegramProfile, TelegramRecipientReference } from "../domain/messages.js";

export interface ConversationMapping {
  messenger: MessengerKind;
  messengerAccountId: string;
  providerConversationId?: string;
  providerRecipientId: string;
  providerRecipientRef?: TelegramRecipientReference;
  providerRecipientSecretRef?: string;
  providerProfile?: TelegramProfile;
  amoConversationId?: string;
  amoContactId?: number;
  amoLeadId?: number;
  amoScopeId: string;
  writeFirstState?: "none"|"pending"|"linked"|"failed";
  lastInboundAt?:Date;
}
export interface MessageMapping {
  messenger: MessengerKind; messengerAccountId: string; messengerMessageId: string;
  providerConversationId: string; amoMessageId?: string; amoConversationId?: string;
  direction: MessageDirection; status: MessageStatus; statusAt?: Date; occurredAt: Date;
}
export interface MappingStore {
  getConversation(messenger:MessengerKind,accountId:string,providerConversationId:string):Promise<ConversationMapping|undefined>;
  findConversationByRecipient(messenger:MessengerKind,accountId:string,providerRecipientId:string):Promise<ConversationMapping|undefined>;
  findConversationByAmoId(amoConversationId:string):Promise<ConversationMapping|undefined>;
  upsertConversation(mapping:ConversationMapping):Promise<void>;
  saveMessage(mapping:MessageMapping):Promise<void>;
  findMessageByAmoId(amoMessageId:string):Promise<MessageMapping|undefined>;
  findMessageByMessengerId(messenger:MessengerKind,accountId:string,externalMessageId:string):Promise<MessageMapping|undefined>;
  updateMessageStatus(messenger:MessengerKind,accountId:string,externalMessageId:string,status:MessageStatus,statusAt?:Date):Promise<void>;
  listDeliveryUnknown(limit:number):Promise<MessageMapping[]>;
  reconcileDeliveryUnknown(amoMessageId:string,providerMessageId:string,status:"queued"|"sent"|"delivered"|"read"):Promise<boolean>;
  clearDeliveryUnknown(amoMessageId:string):Promise<boolean>;
}

export class InMemoryMappingStore implements MappingStore {
  private conversations:ConversationMapping[]=[];private messages:MessageMapping[]=[];
  async getConversation(m:MessengerKind,a:string,c:string){return this.conversations.find(x=>x.messenger===m&&x.messengerAccountId===a&&x.providerConversationId===c);}
  async findConversationByRecipient(m:MessengerKind,a:string,r:string){return this.conversations.find(x=>x.messenger===m&&x.messengerAccountId===a&&x.providerRecipientId===r);}
  async findConversationByAmoId(id:string){return this.conversations.find(x=>x.amoConversationId===id);}
  async upsertConversation(x:ConversationMapping){const old=await this.findConversationByRecipient(x.messenger,x.messengerAccountId,x.providerRecipientId);if(old)Object.assign(old,x);else this.conversations.push({...x});}
  async saveMessage(x:MessageMapping){const old=await this.findMessageByMessengerId(x.messenger,x.messengerAccountId,x.messengerMessageId);if(old)Object.assign(old,x);else this.messages.push({...x,statusAt:x.statusAt??x.occurredAt});}
  async findMessageByAmoId(id:string){return this.messages.find(x=>x.amoMessageId===id);}
  async findMessageByMessengerId(m:MessengerKind,a:string,id:string){return this.messages.find(x=>x.messenger===m&&x.messengerAccountId===a&&x.messengerMessageId===id);}
  async updateMessageStatus(m:MessengerKind,a:string,id:string,status:MessageStatus,statusAt=new Date()){const x=await this.findMessageByMessengerId(m,a,id);if(x&&(status==="failed"||statusRank(status)>=statusRank(x.status))&&statusAt>=(x.statusAt??x.occurredAt)){x.status=status;x.statusAt=statusAt;}}
  async listDeliveryUnknown(limit:number){return this.messages.filter(x=>x.status==="delivery_unknown").slice(0,limit);}
  async reconcileDeliveryUnknown(amoId:string,providerId:string,status:"queued"|"sent"|"delivered"|"read"){const x=this.messages.find(v=>v.amoMessageId===amoId&&v.status==="delivery_unknown");if(!x)return false;x.messengerMessageId=providerId;x.status=status;x.statusAt=new Date();return true;}
  async clearDeliveryUnknown(amoId:string){const i=this.messages.findIndex(v=>v.amoMessageId===amoId&&v.status==="delivery_unknown");if(i<0)return false;this.messages.splice(i,1);return true;}
}
function statusRank(s:MessageStatus){return({delivery_unknown:-2,queued:0,sent:1,delivered:2,read:3,failed:-1})[s];}
