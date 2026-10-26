import {describe,expect,it,vi} from 'vitest';
import {S3MediaStore} from '../src/media/s3-media-store.js';
import {TelegramAdapter} from '../src/adapters/telegram-adapter.js';
import {MessageRouter} from '../src/router/message-router.js';
import {HttpError} from '../src/http/http-error.js';
import {InMemoryAccountRepository} from '../src/storage/account-repository.js';
import {InMemoryMappingStore} from '../src/storage/mapping-store.js';
import {InMemoryAdapterRegistry} from '../src/adapters/messenger-adapter.js';
import {InMemorySecretStore} from '../src/security/secret-store.js';

describe('media sync hotfix v6',()=>{
 it('preserves the scanned, bounded downloaded bytes for direct Telegram upload',async()=>{
  const input=Buffer.from('%PDF-test');
  const scanner={scan:vi.fn(async()=>{})};
  const downloader={download:vi.fn(async()=>({data:input,mimeType:'application/pdf'}))};
  const send=vi.fn(async()=>({}));
  const store=new S3MediaStore({client:{send} as any,bucket:'private-bucket',urlTtlSeconds:900,maxBytes:100,
    downloader:downloader as any,scanner,publicBaseUrl:'https://sinaichannel.ru',publicTokenKey:'long-secret-key-for-local-tests-2026'});
  const result=await store.ingestRemote({url:'https://drive-a.amocrm.ru/doc',kind:'file',fileName:'report.pdf',sourceId:'amo:123'});
  expect(result.uploadBytes).toEqual(input);
  expect(result.fileName).toBe('report.pdf');
  expect(scanner.scan).toHaveBeenCalledWith(input);
  expect(send).toHaveBeenCalledTimes(1);
 });
 it('uploads a Buffer rather than asking Telegram to curl the signed URL',async()=>{
  const sendFile=vi.fn(async(_recipient:any,_params:any)=>({id:53,date:1793000000}));
  const fake={getInputEntity:vi.fn(async(entity:any)=>entity),sendFile,sendMessage:vi.fn()};
  const adapter=new TelegramAdapter({accountId:'a1',apiId:1,apiHash:'hash',session:'session',client:fake as any});
  const bytes=Buffer.from('%PDF-1.4');
  const result=await adapter.send({accountId:'a1',conversationId:'123',recipientId:'123',
    recipientReference:{kind:'telegram_input_peer_user',userId:'123',accessHash:'987'},
    text:'caption',attachments:[{kind:'file',url:'https://sinaichannel.ru/media/token',uploadBytes:bytes,fileName:'doc.pdf'}],
    idempotencyKey:'amo-message-1'});
  expect(result.externalMessageId).toBe('53');
  expect(sendFile).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({file:expect.any(Buffer),forceDocument:true,caption:'caption'}));
  const sentFile=sendFile.mock.calls[0]![1] as any;
  expect(Buffer.from(sentFile.file)).toEqual(bytes);
  expect(sentFile.file.name).toBe('doc.pdf');
 });
 async function fixture(fails=false){
  const accounts=new InMemoryAccountRepository();
  await accounts.upsert({id:'tg-test',messenger:'telegram',providerAccountId:'phone',credentialRef:'secret',
    amoAccountId:'amo',amoScopeId:'scope',sourceExternalId:'source',config:{},state:'connected',displayName:'Operator'});
  const store=new InMemoryMappingStore();const logger={error:vi.fn()};
  const chats={sendMessage:vi.fn(async()=>{
   if(fails)throw new HttpError(400,'POST','https://amojo.amocrm.ru/v2/origin/custom/scope',undefined,'{"error":"invalid sender.ref_id"}');
   return {new_message:{msgid:'amo-msg',conversation_id:'amo-conv'}};
  })};
  const router=new MessageRouter({store,accounts,secrets:new InMemorySecretStore(),adapters:new InMemoryAdapterRegistry(),
    chats:chats as any,externalEchoDelayMs:0,amoBotRefId:'bot-ref-from-registration',logger});
  const msg:any={id:'tel-501',messenger:'telegram',accountId:'tg-test',conversationId:'77123',direction:'outbound',
    sender:{externalId:'tg-self-tg-test'},recipient:{externalId:'77123',displayName:'Client'},text:'from mobile',
    attachments:[],status:'sent',occurredAt:new Date('2026-10-26T10:00:00Z')};
  return {router,chats,logger,msg};
 }
 it('uses registered amoCRM Chats bot ref_id for messages sent from Telegram itself',async()=>{
  const {router,chats,msg}=await fixture();
  await router.routeInbound(msg);
  expect(chats.sendMessage).toHaveBeenCalledWith('scope',expect.objectContaining({
    payload:expect.objectContaining({sender:expect.objectContaining({ref_id:'bot-ref-from-registration'}),silent:true})}));
 });
 it('logs the sanitized 400 validation response without dumping the outgoing message',async()=>{
  const {router,logger,msg}=await fixture(true);
  await expect(router.routeInbound(msg)).rejects.toBeInstanceOf(HttpError);
  expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({httpStatus:400,responseBody:'{"error":"invalid sender.ref_id"}',botRefConfigured:true}),expect.any(String));
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('from mobile');
 });
});