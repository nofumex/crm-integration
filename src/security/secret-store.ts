import type { Pool } from "pg";
import { decryptSession,encryptSession } from "./session-crypto.js";

export interface SecretStore { put(id:string,value:Record<string,unknown>):Promise<void>; get<T extends Record<string,unknown>>(id:string):Promise<T|undefined>; delete(id:string):Promise<void>; }
export class EncryptedPostgresSecretStore implements SecretStore {
 constructor(private readonly pool:Pool,private readonly masterKey:string){if(masterKey.length<32)throw new Error("SECRET_MASTER_KEY must contain at least 32 characters");}
 async put(id:string,value:Record<string,unknown>){const encrypted=encryptSession(JSON.stringify(value),this.masterKey);await this.pool.query("INSERT INTO secrets(id,ciphertext) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,updated_at=now()",[id,encrypted]);}
 async get<T extends Record<string,unknown>>(id:string):Promise<T|undefined>{const r=await this.pool.query("SELECT ciphertext FROM secrets WHERE id=$1",[id]);return r.rows[0]?JSON.parse(decryptSession(r.rows[0].ciphertext,this.masterKey)) as T:undefined;}
 async delete(id:string){await this.pool.query("DELETE FROM secrets WHERE id=$1",[id]);}
}
export class InMemorySecretStore implements SecretStore {private data=new Map<string,Record<string,unknown>>();async put(id:string,v:Record<string,unknown>){this.data.set(id,structuredClone(v));}async get<T extends Record<string,unknown>>(id:string){const v=this.data.get(id);return v?structuredClone(v) as T:undefined;}async delete(id:string){this.data.delete(id);}}
