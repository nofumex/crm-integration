import { describe, expect, it } from 'vitest';
import { InMemoryAccountRepository } from '../src/storage/account-repository.js';
import { AmoSourceReconciliationService, sourceExternalIdForAccount } from '../src/amocrm/source-reconciliation.js';
import { SafeHttpClient } from '../src/http/safe-http-client.js';
import { ContactChatResolver } from '../src/amocrm/contact-resolver.js';
import { MessageRouter } from '../src/router/message-router.js';
import { InMemoryMappingStore } from '../src/storage/mapping-store.js';
import { InMemorySecretStore } from '../src/security/secret-store.js';
import { InMemoryAdapterRegistry } from '../src/adapters/messenger-adapter.js';
import { vi } from 'vitest';

const accountId = '946fecea-d32c-49ac-b76f-e4cae765f05c';
const externalId = sourceExternalIdForAccount(accountId);

async function setupSource(origin = 'amo.ext.17354872') {
  const repo = new InMemoryAccountRepository();
  await repo.upsert({id: accountId, messenger: 'telegram', providerAccountId: '+79000000622',
    displayName: 'Telegram 0622', credentialRef: `telegram:${accountId}`,
    amoAccountId: '12345', amoScopeId: 'demo_scope', sourceExternalId: externalId,
    config: {}, state: 'connected'});
  let writes = 0;
  let removals = 0;
  const sources: Array<{id:number;name:string;external_id:string;origin_code:string}> = [];
  const api = {
    getSources: async () => ({_embedded:{sources}}),
    createSources: async (rows: Array<{name:string;external_id:string;origin_code:string}>) => {
      writes++;
      for(const row of rows)sources.push({...row,id:23462535});
    },
    deleteSource: async (id:number) => {removals++; const i=sources.findIndex(x=>x.id===id);if(i>=0)sources.splice(i,1);}
  };
  return {repo, sources, api, service:new AmoSourceReconciliationService(repo, api, origin), counters:()=>({writes,removals})};
}

describe('amoCRM source lifecycle hardening', () => {
  it('creates exactly one source, even with simultaneous requests', async () => {
    const t=await setupSource();
    const [one,two]=await Promise.all([t.service.ensureForAccount(accountId), t.service.ensureForAccount(accountId)]);
    expect(one.amoSourceId).toBe(23462535);
    expect(two.amoSourceId).toBe(23462535);
    expect(t.counters().writes).toBe(1);
    await t.service.ensureForAccount(accountId);
    expect(t.counters().writes).toBe(1);
  });
  it('does not create sources for accounts without an amoCRM scope', async () => {
    const t=await setupSource();
    await t.repo.upsert({id:'22222222-2222-4222-8222-222222222222', messenger:'telegram', providerAccountId:'+79000000555',
      displayName:'Incomplete', credentialRef:'telegram:other', amoAccountId:'12345',
      sourceExternalId:'tg-22222222222242228222222222222222',config:{},state:'connecting'});
    await t.service.reconcile();
    expect(t.counters().writes).toBe(1);
    expect(t.sources).toHaveLength(1);
  });
  it('deletes only its own source, once', async () => {
    const t=await setupSource();
    await t.service.ensureForAccount(accountId);
    const other={id:10,name:'Cheap-Telegram',external_id:'other',origin_code:'cheap'};
    t.sources.push(other);
    expect((await t.service.removeForAccount(accountId)).removed).toBe(true);
    expect((await t.service.removeForAccount(accountId)).removed).toBe(false);
    expect(t.sources).toEqual([other]);
    expect(t.counters().removals).toBe(1);
  });
  it('never deletes an external source with a different origin', async () => {
    const t=await setupSource();
    t.sources.push({id:123,name:'foreign',external_id:externalId,origin_code:'different.origin'});
    await expect(t.service.removeForAccount(accountId)).rejects.toThrow('ownership');
    expect(t.counters().removals).toBe(0);
  });
});

describe('HTTP network retry hardening', () => {
  it('retries failed GET and eventually succeeds', async () => {
    let count=0;
    const http=new SafeHttpClient({baseUrl:'https://example.test',transport:async()=>{
      count++;if(count<3)throw new TypeError('fetch failed');return new Response('{"ok":true}',{status:200});
    }});
    expect(await http.request('GET','/api')).toEqual({ok:true});
    expect(count).toBe(3);
  });
  it('never replays a failed POST', async () => {
    let count=0;
    const http=new SafeHttpClient({baseUrl:'https://example.test',readOnly:false,transport:async()=>{
      count++;throw new TypeError('fetch failed');
    }});
    await expect(http.request('POST','/api',{body:'{}'})).rejects.toThrow('fetch failed');
    expect(count).toBe(1);
  });
});

describe('safe contact enrichment', () => {
  it('does not patch existing Telegram fields or names already populated', async () => {
    let patched=0;
    const rest={getContact:async()=>({id:42,name:'Egor',first_name:'Egor',custom_fields_values:[
      {field_id:99,values:[{value:'Egor'}]},
      {field_id:100,values:[{value:'GlukhovEM'}]},
      {field_id:101,values:[{value:'8608404966'}]}
    ]}),patchContact:async()=>{patched++;}};
    const resolver=new ContactChatResolver(rest as any, {} as any,
      {telegramNameFieldId:99,telegramUsernameFieldId:100,telegramIdFieldId:101});
    await resolver.enrich(42,{externalId:'8608404966',displayName:'Egor changed',username:'GlukhovEM',profile:{telegramId:'8608404966',firstName:'Egor changed'}});
    expect(patched).toBe(0);
  });
  it('does not patch an existing named contact without changes', async () => {
    let patched=0;
    const rest={getContact:async()=>({id:42,name:'Egor',custom_fields_values:[]}),patchContact:async()=>{patched++;}};
    const resolver=new ContactChatResolver(rest as any, {} as any, {});
    await resolver.enrich(42,{externalId:'8608404966',displayName:'Egor changed',profile:{telegramId:'8608404966',firstName:'Egor changed'}});
    expect(patched).toBe(0);
  });
});


describe('incoming contact isolation', () => {
  it('does not rewrite Cheap-Telegram-managed contacts when sync is disabled', async () => {
    const accounts=new InMemoryAccountRepository();
    await accounts.upsert({id:accountId, messenger:'telegram', providerAccountId:'+79000000622',
      credentialRef:'telegram:'+accountId,amoAccountId:'12345',amoScopeId:'scope-1',
      sourceExternalId:externalId,config:{},state:'connected'});
    const contactResolver={
      findExactByChatId: vi.fn(async()=>({contactId:42,leadId:99})),
      ensureContact: vi.fn(),
      enrich: vi.fn(),
      findExactByPhone: vi.fn(),
      findExactByTelegramId: vi.fn(),
    };
    const chat={sendMessage:vi.fn(async()=>({new_message:{msgid:'amo-1',conversation_id:'amo-chat-1'}}))};
    const router=new MessageRouter({accounts,store:new InMemoryMappingStore(),
      secrets:new InMemorySecretStore(),adapters:new InMemoryAdapterRegistry(),
      chats:chat as any,contactResolver:contactResolver as any,contactSyncEnabled:false});
    await router.routeInbound({id:'msg-1',messenger:'telegram',accountId,
      conversationId:'peer-1',direction:'inbound',sender:{externalId:'peer-1',displayName:'Client'},
      text:'test inbound',attachments:[],occurredAt:new Date(),status:'delivered'});
    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
    expect(contactResolver.enrich).not.toHaveBeenCalled();
    expect(contactResolver.ensureContact).not.toHaveBeenCalled();
  });
});
