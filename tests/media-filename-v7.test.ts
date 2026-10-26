import {describe,it,expect,vi} from 'vitest';
import {S3MediaStore} from '../src/media/s3-media-store.js';
import {TelegramAdapter} from '../src/adapters/telegram-adapter.js';

function setup(){
 const bytes=Buffer.from('hello world');
 const send=vi.fn(async(_command:any)=>({}));
 const scanner={scan:vi.fn(async()=>undefined)};
 const downloader={download:vi.fn(async()=>({data:bytes,mimeType:'text/plain'}))};
 const store=new S3MediaStore({client:{send} as any,bucket:'private-bucket',urlTtlSeconds:900,maxBytes:1000,
   scanner,downloader:downloader as any,publicBaseUrl:'https://sinaichannel.ru',publicTokenKey:'test-only-secret-01234567890123456789'});
 return {store,send,scanner,bytes};
}

describe('amoCRM filename preservation',()=>{
 it('keeps the original Cyrillic filename when uploading to Telegram and keeps MinIO key safe',async()=>{
  const {store,send,bytes,scanner}=setup();
  const original='тест_txt_файл.txt';
  const attachment=await store.ingestRemote({url:'https://drive-a.amocrm.ru/test',kind:'file',fileName:original,sourceId:'amo:186'});
  expect(attachment.fileName).toBe(original);
  expect(attachment.uploadBytes).toEqual(bytes);
  expect(scanner.scan).toHaveBeenCalledWith(bytes);
  const s3Key=send.mock.calls[0]![0].input.Key as string;
  expect(s3Key).not.toContain('тест');
  expect(s3Key).toMatch(/^bridge\/\d{4}-\d{2}-\d{2}\//);
  const sendFile=vi.fn(async(_recipient:any,_params:any)=>({id:123,date:1793000000}));
  const client={getInputEntity:vi.fn(async(x:any)=>x),sendFile,sendMessage:vi.fn()};
  const telegram=new TelegramAdapter({apiId:1,apiHash:'hash',accountId:'tg',session:'test',client:client as any});
  await telegram.send({accountId:'tg',conversationId:'123',recipientId:'123',
   recipientReference:{kind:'telegram_input_peer_user',userId:'123',accessHash:'abc'},
   attachments:[{kind:'file',...attachment}],idempotencyKey:'amo-186'});
  const file=sendFile.mock.calls[0]![1].file as Buffer & {name:string};
  expect(file.name).toBe(original);
  expect(Buffer.from(file)).toEqual(bytes);
 });
 it('strips path components and control characters from delivery name',async()=>{
  const {store}=setup();
  const attachment=await store.ingestRemote({url:'https://drive-a.amocrm.ru/test',kind:'file',fileName:'../folder/инвойс\u0000.pdf',sourceId:'amo:187'});
  expect(attachment.fileName).toBe('инвойс.pdf');
 });
 it('falls back to a safe technical name when amoCRM sends no filename',async()=>{
  const {store}=setup();
  const attachment=await store.ingestRemote({url:'https://drive-a.amocrm.ru/test',kind:'file',sourceId:'amo:188'});
  expect(attachment.fileName).toBe('media.bin');
 });
});