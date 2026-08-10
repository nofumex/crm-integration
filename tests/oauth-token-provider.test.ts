import { describe, expect, it, vi } from "vitest";
import { RefreshingAmoTokenProvider } from "../src/amocrm/oauth-token-provider.js";
import { InMemorySecretStore } from "../src/security/secret-store.js";

describe("amoCRM OAuth token provider",()=>{
 it("rotates and persists access/refresh tokens in test mode",async()=>{const secrets=new InMemorySecretStore();await secrets.put("amo",{accessToken:"old",refreshToken:"refresh-old",expiresAt:0});const transport=vi.fn(async()=>new Response(JSON.stringify({access_token:"new",refresh_token:"refresh-new",expires_in:86400})));const provider=new RefreshingAmoTokenProvider({baseUrl:"https://test.amocrm.ru",integrationId:"id",clientSecret:"secret",redirectUri:"https://bridge/callback",credentialRef:"amo",secrets,writesAllowed:true,transport,now:()=>1000});expect(await provider.getAccessToken()).toBe("new");expect(await secrets.get("amo")).toMatchObject({accessToken:"new",refreshToken:"refresh-new"});});
 it("never refreshes through a read-only production provider",async()=>{const secrets=new InMemorySecretStore();await secrets.put("amo",{accessToken:"old",refreshToken:"refresh",expiresAt:0});const transport=vi.fn();const provider=new RefreshingAmoTokenProvider({baseUrl:"https://prod.amocrm.ru",integrationId:"id",clientSecret:"secret",redirectUri:"https://bridge/callback",credentialRef:"amo",secrets,writesAllowed:false,transport});await expect(provider.getAccessToken()).rejects.toThrow("read-only");expect(transport).not.toHaveBeenCalled();});
});
