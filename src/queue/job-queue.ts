export type JobState = "pending" | "processing" | "completed" | "dead";
export type JobKind = "amocrm.outbound" | "messenger.inbound" | "messenger.status";

export interface NewJob {
  kind: JobKind;
  partitionKey: string;
  dedupeKey: string;
  payload: unknown;
  maxAttempts?: number;
}

export interface Job extends NewJob {
  id: number;
  state: JobState;
  attempts: number;
  availableAt: Date;
}

export interface JobQueue {
  enqueue(job: NewJob): Promise<{ inserted: boolean; id: number }>;
  claim(workerId: string, leaseMs: number): Promise<Job | undefined>;
  heartbeat(id: number, workerId: string): Promise<void>;
  complete(id: number, workerId: string): Promise<void>;
  retry(id: number, workerId: string, error: string, delayMs: number): Promise<void>;
  deadLetter(id: number, workerId: string, error: string): Promise<void>;
  recoverStale(leaseMs: number): Promise<number>;
  counts(): Promise<Record<JobState, number>>;
  deadLetters(limit: number): Promise<Array<{id:number;kind:JobKind;partitionKey:string;attempts:number;lastError?:string}>>;
  requeueDead(id:number):Promise<boolean>;
}
