import {describe,expect,it,vi} from 'vitest';
import {MessageRouter} from '../src/router/message-router.js';
import {InMemoryAccountRepository} from '../src/storage/account-repository.js';
import {InMemoryMappingStore} from '../src/storage/mapping-store.js';
import {InMemoryAdapterRegistry} from '../src/adapters/messenger-adapter.js';
import {InMemorySecretStore} from '../src/security/secret-store.js';

const accountId='tg-account';
const peerId='8608404966';
const chatId='edbc8205-54b1-485d-905a-e5448bbdb36b';

async function setup(mapped:boolean, state:'linked'|'pending'='linked'){
  const accounts=new InMemoryAccountRepository();
  await accounts.upsert({id:accountId,messenger:'telegram',providerAccountId:'0622',credentialRef:'s',
    amoAccountId:'amo',amoScopeId:'scope',sourceExternalId:'source',config:{},state:'connected',displayName:'Operator'});
  const store=new InMemoryMappingStore();
  if(mapped)await store.upsertConversation({messenger:'telegram',messengerAccountId:accountId,
    providerConversationId:peerId,providerRecipientId:peerId,amoConversationId:chatId,
    amoContactId:41528051,amoLeadId:32535925,amoScopeId:'scope',writeFirstState:state});
  const sendMessage=vi.fn(async()=>({new_message:{msgid:'created-id',conversation_id:chatId}}));
  const router=new MessageRouter({store,accounts,adapters:new InMemoryAdapterRegistry(),
    secrets:new InMemorySecretStore(),chats:{sendMessage} as any,amoBotRefId:'bot-id',externalEchoDelayMs:0});
  return {router,sendMessage};
}
function outgoing(){return{id:'13170',messenger:'telegram' as const,accountId,conversationId:peerId,
  direction:'outbound' as const,sender:{externalId:'tg-self-'+accountId},recipient:{externalId:peerId,displayName:'Client'},
  text:'test',attachments:[],status:'sent' as const,occurredAt:new Date('2026-10-26T12:00:00Z')};}
function incoming(){return{...outgoing(),id:'13171',direction:'inbound' as const,
  sender:{externalId:peerId,displayName:'Client'},recipient:undefined};}

describe('amoCRM conversation routing v9',()=>{
  it('explicitly targets the mapped amoCRM chat for a Telegram-phone outgoing message',async()=>{
    const {router,sendMessage}=await setup(true,'linked');
    await router.routeInbound(outgoing());
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const payload=(sendMessage.mock.calls[0] as any)[1].payload;
    expect(payload.conversation_id).toBe(peerId);
    expect(payload.conversation_ref_id).toBe(chatId);
    expect(payload.sender.ref_id).toBe('bot-id');
    expect(payload.receiver.id).toBe(peerId);
  });
  it('explicitly targets the mapped amoCRM chat for incoming Telegram messages too',async()=>{
    const {router,sendMessage}=await setup(true,'linked');
    await router.routeInbound(incoming());
    expect((sendMessage.mock.calls[0] as any)[1].payload.conversation_ref_id).toBe(chatId);
  });
  it('keeps conversation_ref_id on write-first pending mappings',async()=>{
    const {router,sendMessage}=await setup(true,'pending');
    await router.routeInbound(incoming());
    expect((sendMessage.mock.calls[0] as any)[1].payload.conversation_ref_id).toBe(chatId);
  });
  it('does not invent an amoCRM chat ID for a new unmapped Telegram dialog',async()=>{
    const {router,sendMessage}=await setup(false);
    await router.routeInbound(outgoing());
    expect((sendMessage.mock.calls[0] as any)[1].payload).not.toHaveProperty('conversation_ref_id');
  });
});