import type { Job, JobQueue, JobState, NewJob } from "./job-queue.js";

interface StoredJob extends Job { lockedBy?: string; lockedAt?: Date; lastError?: string }

export class InMemoryJobQueue implements JobQueue {
  private sequence = 0;
  private readonly jobs: StoredJob[] = [];
  private now: () => Date;
  constructor(now: () => Date = () => new Date()) { this.now = now; }
  setClock(now: () => Date): void { this.now = now; }
  async enqueue(input: NewJob): Promise<{ inserted: boolean; id: number }> {
    const existing=this.jobs.find(j=>j.kind===input.kind&&j.dedupeKey===input.dedupeKey);if(existing){if(JSON.stringify(existing.payload)!==JSON.stringify(input.payload))throw new Error("Duplicate job key has a different payload hash");return{inserted:false,id:existing.id};}
    const job:StoredJob={...input,id:++this.sequence,state:"pending",attempts:0,maxAttempts:input.maxAttempts??12,availableAt:this.now()};this.jobs.push(job);return{inserted:true,id:job.id};
  }
  async claim(workerId:string):Promise<Job|undefined>{const now=this.now();const job=this.jobs.filter(j=>j.state==="pending"&&j.availableAt<=now&&!this.jobs.some(e=>e.partitionKey===j.partitionKey&&e.id<j.id&&(e.state==="pending"||e.state==="processing"))).sort((a,b)=>a.id-b.id)[0];if(!job)return undefined;job.state="processing";job.lockedBy=workerId;job.lockedAt=now;job.attempts++;return{...job};}
  async heartbeat(id:number,workerId:string):Promise<void>{this.lease(id,workerId).lockedAt=this.now();}
  async complete(id:number,workerId:string):Promise<void>{const j=this.lease(id,workerId);j.state="completed";j.lockedBy=undefined;j.lockedAt=undefined;}
  async retry(id:number,workerId:string,error:string,delayMs:number):Promise<void>{const j=this.lease(id,workerId);j.state=j.attempts>=j.maxAttempts! ? "dead":"pending";j.availableAt=new Date(this.now().getTime()+delayMs);j.lastError=error;j.lockedBy=undefined;j.lockedAt=undefined;}
  async deadLetter(id:number,workerId:string,error:string):Promise<void>{const j=this.lease(id,workerId);j.state="dead";j.lastError=error;j.lockedBy=undefined;j.lockedAt=undefined;}
  async recoverStale(leaseMs:number):Promise<number>{let n=0;for(const j of this.jobs)if(j.state==="processing"&&j.lockedAt!.getTime()<this.now().getTime()-leaseMs){j.state=j.attempts>=j.maxAttempts!?"dead":"pending";j.lockedAt=undefined;j.lockedBy=undefined;n++;}return n;}
  async counts():Promise<Record<JobState,number>>{const c:Record<JobState,number>={pending:0,processing:0,completed:0,dead:0};for(const j of this.jobs)c[j.state]++;return c;}
  async deadLetters(limit:number){return this.jobs.filter(j=>j.state==="dead").slice(0,Math.max(0,limit)).map(j=>({id:j.id,kind:j.kind,partitionKey:j.partitionKey,attempts:j.attempts,lastError:j.lastError}));}
  async requeueDead(id:number){const j=this.jobs.find(x=>x.id===id&&x.state==="dead");if(!j)return false;j.state="pending";j.attempts=0;j.availableAt=this.now();j.lastError=undefined;return true;}
  private lease(id:number,workerId:string):StoredJob{const j=this.jobs.find(x=>x.id===id);if(!j||j.state!=="processing"||j.lockedBy!==workerId)throw new Error("Job lease was lost");return j;}
}
