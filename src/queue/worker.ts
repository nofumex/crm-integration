import { randomUUID } from "node:crypto";
import type { Job, JobKind, JobQueue } from "./job-queue.js";
import { HttpError } from "../http/http-error.js";

export type JobHandler = (job: Job) => Promise<void>;

export interface WorkerOptions {
  queue: JobQueue;
  handlers: Partial<Record<JobKind, JobHandler>>;
  workerId?: string;
  leaseMs?: number;
  pollMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  logger?: { info(data:unknown,message?:string):void; error(data:unknown,message?:string):void };
}

export class DurableWorker {
  readonly workerId: string;
  private readonly leaseMs: number;
  private running = false;
  constructor(private readonly options: WorkerOptions) { this.workerId=options.workerId??randomUUID();this.leaseMs=options.leaseMs??60_000; }

  async pollOnce(): Promise<boolean> {
    const job=await this.options.queue.claim(this.workerId,this.leaseMs);if(!job)return false;
    const handler=this.options.handlers[job.kind];
    if(!handler){await this.options.queue.deadLetter(job.id,this.workerId,`No handler for ${job.kind}`);return true;}
    const heartbeat=setInterval(()=>void this.options.queue.heartbeat(job.id,this.workerId).catch(()=>undefined),Math.max(1000,Math.floor(this.leaseMs/3)));
    heartbeat.unref?.();
    try { await handler(job); await this.options.queue.complete(job.id,this.workerId); }
    catch(error){const decision=retryDecision(error,job.attempts,this.options);const message=safeError(error);if(decision.retry)await this.options.queue.retry(job.id,this.workerId,message,decision.delayMs);else await this.options.queue.deadLetter(job.id,this.workerId,message);this.options.logger?.error({jobId:job.id,kind:job.kind,retry:decision.retry},"job failed");}
    finally{clearInterval(heartbeat);}
    return true;
  }

  async start(signal: AbortSignal): Promise<void> {
    if(this.running)throw new Error("Worker already started");this.running=true;
    await this.options.queue.recoverStale(this.leaseMs);
    try { while(!signal.aborted){const handled=await this.pollOnce();if(!handled)await abortableDelay(this.options.pollMs??250,signal);} }
    finally { this.running=false; }
  }
}

export function retryDecision(error:unknown,attempt:number,options:Pick<WorkerOptions,"baseDelayMs"|"maxDelayMs"|"random">):{retry:boolean;delayMs:number}{
  if(error instanceof HttpError && !error.retryable)return{retry:false,delayMs:0};
  const retryAfter=error instanceof HttpError ? error.retryAfterMs : undefined;
  if(!(error instanceof HttpError)&&!isTransientDependencyError(error))return{retry:false,delayMs:0};
  const base=options.baseDelayMs??500;const max=options.maxDelayMs??300_000;const exponential=Math.min(max,base*2**Math.max(0,attempt-1));
  const jitter=Math.floor(exponential*(0.5+(options.random??Math.random)()*0.5));return{retry:true,delayMs:retryAfter??jitter};
}
function isTransientDependencyError(error:unknown):boolean{const e=error as any;const code=String(e?.code??"");if(["ECONNRESET","ECONNREFUSED","EHOSTUNREACH","ENETUNREACH","ETIMEDOUT","EAI_AGAIN","UND_ERR_CONNECT_TIMEOUT","UND_ERR_SOCKET"].includes(code))return true;if(e?.name==="TimeoutError"||e?.name==="AbortError"||error instanceof TypeError)return true;if(/^(08|40|53|57P|58)/.test(code)||code==="55P03")return true;const status=Number(e?.$metadata?.httpStatusCode);return status===408||status===429||status>=500;}
function safeError(error:unknown):string{return error instanceof Error?`${error.name}: ${error.message}`:"Unknown error";}
function abortableDelay(ms:number,signal:AbortSignal):Promise<void>{return new Promise(resolve=>{if(signal.aborted)return resolve();const timer=setTimeout(done,ms);function done(){clearTimeout(timer);signal.removeEventListener("abort",done);resolve();}signal.addEventListener("abort",done,{once:true});});}
