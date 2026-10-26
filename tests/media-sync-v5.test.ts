import {describe,it,expect,vi} from 'vitest';
import {Readable} from 'node:stream';
import {S3MediaStore} from '../src/media/s3-media-store.js';
import {SafeMediaDownloader} from '../src/media/safe-downloader.js';
import {TelegramAdapter} from '../src/adapters/telegram-adapter.js';
import {MessageRouter} from '../src/router/message-router.js';
import {buildWebhookServer} from '../src/webhooks/server.js';
import {InMemoryAccountRepository} from '../src/storage/account-repository.js';
import {InMemoryMappingStore} from '../src/storage/mapping-store.js';
import {InMemoryAdapterRegistry} from '../src/adapters/messenger-adapter.js';
import {InMemorySecretStore} from '../src/security/secret-store.js';

function mediaFixture(){
 const send=vi.fn(async(c:any)=>{
  if(c.constructor.name==='GetObjectCommand')return {Body:Readable.from(Buffer.from('hello')),ContentType:'text/plain',ContentLength:5};
  if(c.constructor.name==='HeadObjectCommand')return {ContentType:'text/plain',ContentLength:5};
  return {};
 });
 const scanner={scan:vi.fn(async()=>{})};
 const store=new S3MediaStore({client:{send} as any,bucket:'private-bucket',urlTtlSeconds:900,maxBytes:100,
  downloader:{} as any,scanner,publicBaseUrl:'https://sinaichannel.ru',publicTokenKey:'a-very-long-testing-secret-key-123456'});
 return {store,send,scanner};
}

describe('media v5: private storage with signed public proxy',()=>{
 it('uploads without unsupported SSE-S3 and issues tamper-resistant HTTPS link',async()=>{
  const {store,send}=mediaFixture();
  const uploaded=await store.put({data:Buffer.from('hello'),sourceId:'test-message',kind:'file',mimeType:'text/plain',fileName:'report.txt'});
  expect(uploaded.url).toMatch(/^https:\/\/sinaichannel\.ru\/media\/[^/?#]+$/);
  expect(send.mock.calls[0]![0].input.ServerSideEncryption).toBeUndefined();
  const token=uploaded.url.split('/media/')[1]!;
  const data=await store.openPublicToken(token);
  expect(data.contentType).toBe('text/plain');
  expect(await store.headPublicToken(token)).toMatchObject({contentLength:5});
  await expect(store.openPublicToken(token.slice(0,-1)+(token.endsWith('x')?'y':'x'))).rejects.toThrow('Invalid media token');
  await expect(store.openPublicToken('bogus')).rejects.toThrow('Invalid media token');
 });
 it('serves a signed object through the Fastify HTTPS-proxy route; rejects unsigned access',async()=>{
  const {store}=mediaFixture();
  const uploaded=await store.put({data:Buffer.from('hello'),kind:'file',mimeType:'text/plain',fileName:'test.txt',sourceId:'x'});
  const token=uploaded.url.split('/media/')[1]!;
  const app=buildWebhookServer({queue:{} as any,publicMedia:store});
  try{
    await app.ready();
    const ok=await app.inject({method:'GET',url:'/media/'+token});
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('hello');
    // URL path longer than Fastify's default 100-character parameter bound.
    expect(token.length).toBeGreaterThan(100);
    const head=await app.inject({method:'HEAD',url:'/media/'+token});
    expect(head.statusCode).toBe(200);
    const bad=await app.inject({method:'GET',url:'/media/bad'});
    expect(bad.statusCode).toBe(404);
  }finally{await app.close();}
 });
 it('still scans every uploaded file and rejects oversize',async()=>{
  const {store,send,scanner}=mediaFixture();
  await expect(store.put({data:Buffer.alloc(101),kind:'file',sourceId:'x'})).rejects.toThrow('size limit');
  expect(send).not.toHaveBeenCalled();
  expect(scanner.scan).not.toHaveBeenCalled();
 });
});

describe('trusted amoCRM media redirects',()=>{
 it('follows only allowlisted HTTPS redirects and blocks new hosts',async()=>{
  const transport=vi.fn(async(url:any)=>{
    if(new URL(String(url)).pathname==='/first')return new Response(null,{status:302,headers:{location:'https://8.8.8.8/second'}});
    return new Response(new Uint8Array([1,2]),{headers:{'content-type':'application/pdf'}});
  });
  const downloader=new SafeMediaDownloader({maxBytes:100,timeoutMs:1000,allowedHosts:['8.8.8.8'],transport});
  expect((await downloader.download('https://8.8.8.8/first')).data).toHaveLength(2);
  const redirected=new SafeMediaDownloader({maxBytes:100,timeoutMs:1000,allowedHosts:['8.8.8.8'],
    transport:vi.fn(async()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}}))});
  await expect(redirected.download('https://8.8.8.8/first')).rejects.toThrow(/allowlisted|Private/);
 });
});

describe('external Telegram outbound synchronization',()=>{
 it('imports outgoing Telegram messages without sending them to Telegram a second time',async()=>{
  const accounts=new InMemoryAccountRepository();
  await accounts.upsert({id:'tg-test',messenger:'telegram',providerAccountId:'+79000000000',displayName:'Telegram test',credentialRef:'secret',amoAccountId:'account-amo',amoScopeId:'scope-amo',sourceExternalId:'source-test',state:'connected',config:{}});
  const store=new InMemoryMappingStore();const secrets=new InMemorySecretStore();const adapters=new InMemoryAdapterRegistry();
  const chats={sendMessage:vi.fn(async()=>({new_message:{msgid:'amo-imported',conversation_id:'amo-conv'}})),updateDeliveryStatus:vi.fn()} as any;
  const router=new MessageRouter({store,accounts,secrets,adapters,chats,externalEchoDelayMs:0});
  const out:any={id:'tg-out-222',messenger:'telegram',accountId:'tg-test',conversationId:'8608404966',direction:'outbound',
   sender:{externalId:'tg-self-tg-test',displayName:'Telegram test'},
   recipient:{externalId:'8608404966',displayName:'Client',profile:{telegramId:'8608404966'}},
   text:'sent on phone',attachments:[],status:'delivered',occurredAt:new Date('2026-10-26T10:00:00Z')};
  await router.routeInbound(out);
  const req=chats.sendMessage.mock.calls[0]![1];
  expect(req).toMatchObject({event_type:'new_message',payload:{source:{external_id:'source-test'},sender:{id:'tg-self-tg-test'},receiver:{id:'8608404966'},message:{type:'text',text:'sent on phone'},silent:true}});
  await router.routeInbound(out);
  expect(chats.sendMessage).toHaveBeenCalledTimes(1);
  const found=await store.findMessageByMessengerId('telegram','tg-test','tg-out-222');
  expect(found).toMatchObject({direction:'outbound',amoMessageId:'amo-imported'});
 });
 it('recognizes messages already delivered through the bridge',async()=>{
  const accounts=new InMemoryAccountRepository();
  await accounts.upsert({id:'tg-test',messenger:'telegram',providerAccountId:'phone',credentialRef:'secret',amoAccountId:'amo',amoScopeId:'scope',sourceExternalId:'source',config:{},state:'connected'});
  const store=new InMemoryMappingStore();
  await store.saveMessage({messenger:'telegram',messengerAccountId:'tg-test',messengerMessageId:'991',providerConversationId:'123',amoMessageId:'amo-sent',amoConversationId:'crm-conv',direction:'outbound',status:'sent',statusAt:new Date(),occurredAt:new Date()});
  const chats={sendMessage:vi.fn()};
  const router=new MessageRouter({store,accounts,secrets:new InMemorySecretStore(),adapters:new InMemoryAdapterRegistry(),chats:chats as any,externalEchoDelayMs:0});
  await router.routeInbound({id:'991',messenger:'telegram',accountId:'tg-test',conversationId:'123',direction:'outbound',sender:{externalId:'self'},recipient:{externalId:'123'},text:'hello',attachments:[],status:'sent',occurredAt:new Date()});
  expect(chats.sendMessage).not.toHaveBeenCalled();
 });
 it('collects Telegram outgoing events from other devices and ignores bridge-sent echo',async()=>{
  let eventHandler:((evt:any)=>Promise<void>)|undefined;
  const fake={connected:true,session:{save:()=>''},connect:async()=>{},disconnect:async()=>{},isUserAuthorized:async()=>true,
   addEventHandler:vi.fn((fn:any)=>{eventHandler=fn;}),getEntity:vi.fn(async()=>({id:99,firstName:'Remote',accessHash:'hash'})),
   getInputEntity:vi.fn(async()=>({className:'InputPeerUser',userId:99,accessHash:'hash'})),
   sendMessage:vi.fn(async()=>({id:72,date:1793000000})),sendFile:vi.fn(),downloadMedia:vi.fn()};
  const adapter=new TelegramAdapter({accountId:'self-account',apiId:1,apiHash:'hash',session:'session',client:fake as any});
  const inbound=vi.fn(async()=>{});adapter.onInbound(inbound);await adapter.connect('self-account');
  await eventHandler!({message:{id:71,out:true,chatId:99,peerId:{className:'PeerUser',userId:99},message:'sent from mobile',date:1793000000}});
  expect(inbound).toHaveBeenCalledWith(expect.objectContaining({direction:'outbound',recipient:expect.objectContaining({externalId:'99'})}));
  await adapter.send({accountId:'self-account',conversationId:'99',recipientId:'99',text:'via crm',idempotencyKey:'amo-key'});
  await eventHandler!({message:{id:72,out:true,chatId:99,peerId:{className:'PeerUser',userId:99},message:'via crm',date:1793000000}});
  expect(inbound).toHaveBeenCalledTimes(1);
 });
});
