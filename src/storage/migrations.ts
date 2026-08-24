import{readFile,readdir}from"node:fs/promises";
import{resolve}from"node:path";
import type{Pool}from"pg";
export async function migrate(pool:Pool):Promise<void>{const directory=resolve(process.cwd(),"migrations");const files=(await readdir(directory)).filter(x=>/^\d+.*\.sql$/.test(x)).sort();const client=await pool.connect();try{for(const file of files){await client.query("BEGIN");await client.query(await readFile(resolve(directory,file),"utf8"));await client.query("COMMIT");}}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}}
export async function validateSchema(pool:Pool):Promise<void>{const r=await pool.query("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1");if(Number(r.rows[0]?.version)!==3)throw new Error("Database schema is not migrated; run npm run migrate");}
