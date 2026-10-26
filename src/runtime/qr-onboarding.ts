import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import type { SecretStore } from '../security/secret-store.js';
import type { AccountRepository } from '../domain/accounts.js';
import type { ReconnectSupervisor } from './adapter-runtime.js';
import { sourceExternalIdForAccount } from '../amocrm/source-reconciliation.js';

type QrState = 'starting'|'qr'|'password'|'connected'|'error'|'cancelled';
type Job = {state: QrState; image?: string; expires?: number; error?: string; accountId?: string;
  client?: TelegramClient; resolvePassword?: (password: string) => void; created: number; cancelled: boolean};

export class TelegramQrOnboardingService {
  private jobs = new Map<string,Job>();
  constructor(private secrets:SecretStore,private accounts:AccountRepository,
    private supervisor:ReconnectSupervisor,private api:{apiId:number;apiHash:string}) {}

  start(input:{amoAccountId:string;displayName?:string}):{id:string} {
    if(!/^\d+$/.test(input.amoAccountId?.trim()??''))throw new Error('Specify numeric amoCRM Account ID');
    if([...this.jobs.values()].some(j=>['starting','qr','password'].includes(j.state)))
      throw new Error('QR login already active. Finish or cancel it first.');
    const id=randomUUID();
    const job:Job={state:'starting',created:Date.now(),cancelled:false};
    this.jobs.set(id,job);
    void this.run(id,job,{amoAccountId:input.amoAccountId.trim(),displayName:input.displayName?.trim()}).catch(e=>{
      if(!job.cancelled){job.state='error';job.error=e instanceof Error?e.message:'QR login failed';}
    }).finally(()=>{const t=setTimeout(()=>this.jobs.delete(id),10*60*1000);t.unref();});
    return {id};
  }

  status(id:string){const j=this.required(id);return {state:j.state,image:j.state==='qr'?j.image:undefined,
    expires:j.expires,error:j.error,accountId:j.accountId};}

  password(id:string,password:string){const j=this.required(id);
    if(j.state!=='password'||!j.resolvePassword)throw new Error('2FA password is not requested');
    if(!password)throw new Error('2FA password is empty');
    const accept=j.resolvePassword;j.resolvePassword=undefined;accept(password);return {ok:true};}

  async cancel(id:string){const j=this.required(id);j.cancelled=true;j.state='cancelled';
    if(j.resolvePassword){j.resolvePassword('');j.resolvePassword=undefined;}
    try{await j.client?.disconnect();}catch{};return {ok:true};}

  private required(id:string){const j=this.jobs.get(id);if(!j)throw new Error('QR login expired or not found');return j;}

  private async run(id:string,j:Job,input:{amoAccountId:string;displayName?:string}){
    const client = new TelegramClient(new StringSession(''),this.api.apiId,this.api.apiHash,
      {connectionRetries:3,autoReconnect:false});
    j.client=client;
    try{
      await client.connect();
      await client.signInUserWithQrCode(this.api,{
        qrCode:async ({token,expires})=>{
          if(j.cancelled)throw new Error('QR login cancelled');
          const url='tg://login?token='+token.toString('base64url');
          j.image=await QRCode.toDataURL(url,{width:320,margin:2,errorCorrectionLevel:'M'});
          j.expires=expires;j.state='qr';
        },
        password:async()=>{
          if(j.cancelled)throw new Error('QR login cancelled');
          j.image=undefined;j.state='password';
          return new Promise<string>(resolve=>{j.resolvePassword=resolve;});
        },
        onError:async()=>true
      });
      if(j.cancelled) return;
      const me:any=await client.getMe();
      const phone='+'+String(me?.phone??'').replace(/\D/g,'');
      if(phone.length<8)throw new Error('Telegram did not provide account phone');
      const existing=await this.accounts.findByProvider('telegram',phone);
      if(existing)throw new Error('Telegram account already registered: '+phone.slice(-4)+'. Use Reconnect.');
      const accountId=randomUUID(),secretRef=`telegram:${accountId}`;
      await this.secrets.put(secretRef,{session:String(client.session.save()),authorized:true});
      try{
        await this.accounts.upsert({id:accountId,messenger:'telegram',providerAccountId:phone,
          displayName:input.displayName||`Telegram ${phone.slice(-4)}`,credentialRef:secretRef,
          amoAccountId:input.amoAccountId,sourceExternalId:sourceExternalIdForAccount(accountId),
          config:{phone},state:'disconnected'});
      }catch(e){await this.secrets.delete(secretRef);throw e;}
      j.accountId=accountId;
      // The existing supervisor knows how to connect a previously authorized session.
      try{
        await this.supervisor.reconnectAccount(accountId);
        j.state='connected';
      }catch(e){j.state='error';j.error='Session saved; Reconnect failed: '+String(e instanceof Error?e.message:e);}
    }finally{try{await client.disconnect();}catch{};j.client=undefined;}
  }
}
