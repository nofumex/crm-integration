import type { MessageDirection, MessageStatus, MessengerKind } from "../domain/messages.js";

export interface ConversationMapping {
  messenger: MessengerKind;
  messengerAccountId: string;
  providerConversationId?: string;
  providerRecipientId: string;
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
}
function statusRank(s:MessageStatus){return({queued:0,sent:1,delivered:2,read:3,failed:-1})[s];}
