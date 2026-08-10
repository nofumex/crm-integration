import{describe,expect,it}from"vitest";
import{AdapterFactory,MaxPersonalUnavailableError}from"../src/runtime/adapter-runtime.js";
import{InMemoryJobQueue}from"../src/queue/in-memory-job-queue.js";

describe("MAX Personal runtime safety",()=>{it("refuses to pretend that a first-party transport exists",async()=>{const secrets={get:async()=>undefined,put:async()=>{},delete:async()=>{}};const factory=new AdapterFactory(secrets,new InMemoryJobQueue());await expect(factory.create({id:"max-1",messenger:"max",providerAccountId:"personal",credentialRef:"max:1",amoAccountId:"amo",sourceExternalId:"source",config:{},state:"disconnected"})).rejects.toBeInstanceOf(MaxPersonalUnavailableError);});});
