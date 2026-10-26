import {describe,expect,it,vi} from 'vitest';
import {TelegramAdapter} from '../src/adapters/telegram-adapter.js';

describe('outgoing Telegram updates without cached peer entities (v8)',()=>{
  it('queues a phone-originated message even when getChat and getInputChat fail',async()=>{
    let handler:((event:any)=>Promise<void>)|undefined;
    const fake:any={
      connect:vi.fn(async()=>{}),
      isUserAuthorized:vi.fn(async()=>true),
      addEventHandler:vi.fn((fn:any)=>{handler=fn;}),
      getEntity:vi.fn(async()=>{throw new Error('Could not find the input entity');}),
      getInputEntity:vi.fn(async()=>{throw new Error('Could not find the input entity');}),
    };
    const adapter=new TelegramAdapter({accountId:'acc',apiId:1,apiHash:'test',session:'session',client:fake});
    const received:any[]=[];
    adapter.onInbound(async msg=>{received.push(msg);});
    await adapter.connect('acc');
    expect(handler).toBeDefined();
    await handler!({message:{
      id:13168,date:1793019900,chatId:'8608404966',peerId:{className:'PeerUser',userId:'8608404966'},
      out:true,message:'phone test',
      getChat:async()=>{throw new Error('Could not find the input entity');},
      getInputChat:async()=>{throw new Error('Could not find the input entity');}
    }});
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({id:'13168',direction:'outbound',conversationId:'8608404966',
      recipient:{externalId:'8608404966'},text:'phone test'});
  });
});