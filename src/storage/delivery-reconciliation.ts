import type { Pool } from "pg";

/** Atomically removes an ambiguous-send marker and requeues its matching dead job. */
export interface DeliveryReconciliationStore {
  confirmNotAccepted(amoMessageId:string,jobId:number):Promise<boolean>;
}

export class PostgresDeliveryReconciliationStore implements DeliveryReconciliationStore {
  constructor(private readonly pool:Pool){}

  async confirmNotAccepted(amoMessageId:string,jobId:number):Promise<boolean>{
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const job=await client.query("SELECT id FROM jobs WHERE id=$1 AND state='dead' AND last_error LIKE 'DeliveryUnknownError:%' AND payload #>> '{body,message,message,id}'=$2 FOR UPDATE",[jobId,amoMessageId]);
      if(job.rowCount!==1){await client.query("ROLLBACK");return false;}
      const marker=await client.query("DELETE FROM message_mappings WHERE amo_message_id=$1 AND status='delivery_unknown' RETURNING id",[amoMessageId]);
      if(marker.rowCount!==1){await client.query("ROLLBACK");return false;}
      const requeued=await client.query("UPDATE jobs SET state='pending',attempts=0,available_at=now(),last_error=NULL,locked_at=NULL,locked_by=NULL,updated_at=now() WHERE id=$1 AND state='dead'",[jobId]);
      if(requeued.rowCount!==1){await client.query("ROLLBACK");return false;}
      await client.query("COMMIT");return true;
    }catch(error){try{await client.query("ROLLBACK");}catch{}throw error;}finally{client.release();}
  }
}
