import type { AmoCrmRestClient } from "./rest-client.js";

export async function verifyAmoWriteTarget(rest:AmoCrmRestClient,expected:{accountId:string;subdomain:string}):Promise<void>{
 const account=await rest.getAccountWithAmojoId() as any;
 const actualId=String(account?.id??"");const actualSubdomain=String(account?.subdomain??"").toLowerCase();
 if(actualId!==String(expected.accountId)||actualSubdomain!==expected.subdomain.toLowerCase())throw new Error(`amoCRM write target verification failed: expected account ${expected.accountId}/${expected.subdomain}`);
}
