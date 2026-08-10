import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { Job, JobQueue, JobState, NewJob } from "./job-queue.js";

export class PostgresJobQueue implements JobQueue {
  constructor(private readonly pool: Pool) {}

  async enqueue(job: NewJob): Promise<{ inserted: boolean; id: number }> {
    const payload = JSON.stringify(job.payload);
    const hash = createHash("sha256").update(payload).digest("hex");
    const result = await this.pool.query(
      `INSERT INTO jobs(kind,partition_key,dedupe_key,payload,payload_hash,max_attempts)
       VALUES($1,$2,$3,$4::jsonb,$5,$6)
       ON CONFLICT(kind,dedupe_key) DO UPDATE SET updated_at=jobs.updated_at
       WHERE jobs.payload_hash=EXCLUDED.payload_hash
       RETURNING id,(xmax=0) AS inserted`,
      [job.kind, job.partitionKey, job.dedupeKey, payload, hash, job.maxAttempts ?? 12],
    );
    if(!result.rows[0])throw new Error("Duplicate job key has a different payload hash");
    return { id: Number(result.rows[0].id), inserted: result.rows[0].inserted === true };
  }

  async claim(workerId: string, leaseMs: number): Promise<Job | undefined> {
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT j.id FROM jobs j
         WHERE j.state='pending' AND j.available_at<=now()
           AND NOT EXISTS (
             SELECT 1 FROM jobs earlier
             WHERE earlier.partition_key=j.partition_key AND earlier.id<j.id
               AND earlier.state IN ('pending','processing')
           )
         ORDER BY j.available_at,j.id
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE jobs SET state='processing',locked_by=$1,locked_at=now(),attempts=attempts+1,updated_at=now()
       WHERE id=(SELECT id FROM candidate)
       RETURNING *`, [workerId],
    );
    return result.rows[0] ? rowToJob(result.rows[0]) : undefined;
  }

  async complete(id: number, workerId: string): Promise<void> {
    await assertChanged(this.pool.query("UPDATE jobs SET state='completed',completed_at=now(),locked_at=NULL,locked_by=NULL,updated_at=now() WHERE id=$1 AND state='processing' AND locked_by=$2", [id,workerId]));
  }
  async heartbeat(id:number,workerId:string):Promise<void>{
    await assertChanged(this.pool.query("UPDATE jobs SET locked_at=now(),updated_at=now() WHERE id=$1 AND state='processing' AND locked_by=$2",[id,workerId]));
  }
  async retry(id: number, workerId: string, error: string, delayMs: number): Promise<void> {
    await assertChanged(this.pool.query("UPDATE jobs SET state=CASE WHEN attempts>=max_attempts THEN 'dead' ELSE 'pending' END,available_at=now()+($3::bigint*interval '1 millisecond'),last_error=$4,locked_at=NULL,locked_by=NULL,updated_at=now() WHERE id=$1 AND state='processing' AND locked_by=$2", [id,workerId,Math.max(0,delayMs),error.slice(0,1000)]));
  }
  async deadLetter(id: number, workerId: string, error: string): Promise<void> {
    await assertChanged(this.pool.query("UPDATE jobs SET state='dead',last_error=$3,locked_at=NULL,locked_by=NULL,updated_at=now() WHERE id=$1 AND state='processing' AND locked_by=$2", [id,workerId,error.slice(0,1000)]));
  }
  async recoverStale(leaseMs: number): Promise<number> {
    const result = await this.pool.query("UPDATE jobs SET state=CASE WHEN attempts>=max_attempts THEN 'dead' ELSE 'pending' END,locked_at=NULL,locked_by=NULL,available_at=now(),last_error=COALESCE(last_error,'worker lease expired'),updated_at=now() WHERE state='processing' AND locked_at < now()-($1::bigint*interval '1 millisecond')", [leaseMs]);
    return result.rowCount ?? 0;
  }
  async counts(): Promise<Record<JobState, number>> {
    const result = await this.pool.query("SELECT state,count(*)::int AS count FROM jobs GROUP BY state");
    const counts: Record<JobState,number>={pending:0,processing:0,completed:0,dead:0};
    for(const row of result.rows) counts[row.state as JobState]=Number(row.count); return counts;
  }
  async deadLetters(limit:number){const r=await this.pool.query("SELECT id,kind,partition_key,attempts,last_error FROM jobs WHERE state='dead' ORDER BY updated_at DESC LIMIT $1",[Math.min(500,Math.max(1,limit))]);return r.rows.map(x=>({id:Number(x.id),kind:x.kind,partitionKey:x.partition_key,attempts:Number(x.attempts),lastError:x.last_error??undefined}));}
  async requeueDead(id:number,allowDeliveryUnknown=false){const r=await this.pool.query("UPDATE jobs SET state='pending',attempts=0,available_at=now(),last_error=NULL,updated_at=now() WHERE id=$1 AND state='dead' AND ($2 OR last_error IS NULL OR last_error NOT LIKE 'DeliveryUnknownError:%')",[id,allowDeliveryUnknown]);return r.rowCount===1;}
  async cleanup(retention:{payloadBefore:Date;completedBefore:Date;deadBefore:Date}){const pruned=await this.pool.query("UPDATE jobs SET payload='{}'::jsonb,payload_pruned_at=now() WHERE state='completed' AND payload_pruned_at IS NULL AND updated_at<$1",[retention.payloadBefore]);const deleted=await this.pool.query("DELETE FROM jobs WHERE (state='completed' AND updated_at<$1) OR (state='dead' AND updated_at<$2)",[retention.completedBefore,retention.deadBefore]);return{payloadsPruned:pruned.rowCount??0,jobsDeleted:deleted.rowCount??0};}
}

function rowToJob(row:any):Job{return{id:Number(row.id),kind:row.kind,partitionKey:row.partition_key,dedupeKey:row.dedupe_key,payload:row.payload,maxAttempts:Number(row.max_attempts),state:row.state,attempts:Number(row.attempts),availableAt:new Date(row.available_at)};}
async function assertChanged(resultPromise:Promise<{rowCount:number|null}>):Promise<void>{const result=await resultPromise;if(result.rowCount!==1)throw new Error("Job lease was lost");}
