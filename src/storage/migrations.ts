import{readFile}from"node:fs/promises";
import{resolve}from"node:path";
import type{Pool}from"pg";
export async function migrate(pool:Pool):Promise<void>{const sql=await readFile(resolve(process.cwd(),"migrations","001_initial.sql"),"utf8");const client=await pool.connect();try{await client.query("BEGIN");await client.query(sql);await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}}
export async function validateSchema(pool:Pool):Promise<void>{const r=await pool.query("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1");if(Number(r.rows[0]?.version)!==1)throw new Error("Database schema is not migrated; run npm run migrate");}
