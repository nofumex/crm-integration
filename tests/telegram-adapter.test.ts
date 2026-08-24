import { describe, expect, it, vi } from "vitest";
import { TelegramAdapter } from "../src/adapters/telegram-adapter.js";
import type { NormalizedMessage } from "../src/domain/messages.js";

describe("Telegram MTProto adapter", () => {
  it("resolves a persisted Telegram InputPeer before sending instead of passing a raw numeric ID", async () => {
    let eventHandler: ((event: unknown) => Promise<void>) | undefined;
    const fake = { connected:true, session:{save:()=>"new-session"}, connect:vi.fn(async()=>undefined), disconnect:vi.fn(async()=>undefined), isUserAuthorized:vi.fn(async()=>true), addEventHandler:vi.fn((handler:typeof eventHandler)=>{eventHandler=handler;}), getEntity:vi.fn(async()=>({id:77123,accessHash:"9988",firstName:"Ada",lastName:"Lovelace",username:"ada",phone:"+79990000000",bot:false})), getInputEntity:vi.fn(async(entity)=>({resolved:entity})), sendMessage:vi.fn(async()=>({id:55,date:1_700_000_000})), sendFile:vi.fn(), downloadMedia:vi.fn(), start:vi.fn() };
    const adapter=new TelegramAdapter({accountId:"tg-1",apiId:1,apiHash:"hash",session:"ciphertext-loaded-by-secret-store",client:fake as any});const inbound=vi.fn(async()=>undefined);adapter.onInbound(inbound);await adapter.connect("tg-1");
    expect(await adapter.resolveRecipient({username:"client"})).toMatchObject({providerRecipientId:"77123",providerConversationId:"77123",providerRecipientRef:{kind:"telegram_input_peer_user",userId:"77123",accessHash:"9988"}});
    await adapter.send({accountId:"tg-1",conversationId:"77123",recipientId:"77123",recipientReference:{kind:"telegram_input_peer_user",userId:"77123",accessHash:"9988"},text:"hello",idempotencyKey:"amo-1"});
    expect(fake.getInputEntity).toHaveBeenCalledWith(expect.objectContaining({className:"InputPeerUser",userId:"77123",accessHash:"9988"}));
    expect(fake.sendMessage).toHaveBeenCalledWith(expect.objectContaining({resolved:expect.objectContaining({className:"InputPeerUser"})}),{message:"hello"});
    await eventHandler?.({message:{id:8,out:false,chatId:77123,senderId:99,message:"incoming",date:1_700_000_001}});
    expect(inbound).toHaveBeenCalledWith(expect.objectContaining({accountId:"tg-1",conversationId:"77123",id:"8",sender:expect.objectContaining({externalId:"77123",displayName:"Ada Lovelace",username:"ada",phone:"+79990000000",profile:{telegramId:"77123",firstName:"Ada",lastName:"Lovelace",username:"ada",phone:"+79990000000",isBot:false}})}));
  });

  it("uses username or numeric ID as a safe display name when Telegram omits names", async () => {
    let eventHandler: ((event: unknown) => Promise<void>) | undefined;
    const fake={connected:true,session:{save:()=>""},connect:async()=>{},disconnect:async()=>{},isUserAuthorized:async()=>true,addEventHandler:(handler:typeof eventHandler)=>{eventHandler=handler;},getInputEntity:async(entity:unknown)=>entity,getEntity:vi.fn().mockResolvedValueOnce({id:10,username:"only_username"}).mockResolvedValueOnce({id:11}),sendMessage:async()=>({id:1,date:1}),sendFile:async()=>({id:1,date:1}),downloadMedia:async()=>undefined};
    const adapter=new TelegramAdapter({accountId:"tg-1",apiId:1,apiHash:"hash",session:"session",client:fake as any});const inbound=vi.fn(async(_message:NormalizedMessage)=>undefined);adapter.onInbound(inbound);await adapter.connect("tg-1");
    await eventHandler?.({message:{id:1,out:false,chatId:10,senderId:10,message:"a",date:1}});await eventHandler?.({message:{id:2,out:false,chatId:11,senderId:11,message:"b",date:1}});
    expect(inbound.mock.calls[0]![0].sender).toMatchObject({externalId:"10",displayName:"only_username",username:"only_username",profile:{telegramId:"10",username:"only_username"}});
    expect(inbound.mock.calls[1]![0].sender).toMatchObject({externalId:"11",displayName:"11",profile:{telegramId:"11"}});
  });

  it("returns a safe permanent error when an uncached numeric recipient cannot be resolved", async () => {
    const fake={connected:true,session:{save:()=>""},connect:async()=>{},disconnect:async()=>{},isUserAuthorized:async()=>true,addEventHandler:()=>{},getInputEntity:vi.fn(async()=>{throw new Error("Could not find the input entity for secret details");}),sendMessage:vi.fn(),sendFile:vi.fn()};
    const adapter=new TelegramAdapter({accountId:"tg-1",apiId:1,apiHash:"hash",session:"session",client:fake as any});
    await expect(adapter.send({accountId:"tg-1",conversationId:"7727079839",recipientId:"7727079839",text:"hello",idempotencyKey:"amo"})).rejects.toThrow("Telegram recipient metadata is unavailable");expect(fake.sendMessage).not.toHaveBeenCalled();
  });
});
