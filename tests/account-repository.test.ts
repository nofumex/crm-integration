import{describe,expect,it}from"vitest";
import{InMemoryAccountRepository}from"../src/storage/account-repository.js";

describe("messenger account identity",()=>{
 it("allows two Telegram accounts in one amoCRM account to share the global source external id",async()=>{const accounts=new InMemoryAccountRepository();const values:Array<[string,string]>=[["telegram-1","+79990000001"],["telegram-2","+79990000002"]];for(const [id,phone] of values)await accounts.upsert({id,messenger:"telegram",providerAccountId:phone,credentialRef:`telegram:${id}`,amoAccountId:"17354872",sourceExternalId:"telegram-main",config:{phone},state:"disconnected"});expect(await accounts.listAll()).toHaveLength(2);expect(await accounts.findByProvider("telegram","+79990000001")).toMatchObject({id:"telegram-1"});expect(await accounts.findByProvider("telegram","+79990000002")).toMatchObject({id:"telegram-2"});});
});
