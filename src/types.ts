import type {
  Collection,
  Filter,
  InferIdType,
  Sort,
  WithId,
} from "mongodb";

export interface QueueFields {
  state: string;
  availableAt: string;
  attempt: string;
  leaseToken: string;
  leaseOwner: string;
  leaseExpiresAt: string;
  lastError: string;
  completedAt: string;
  failedAt: string;
  updatedAt: string;
}

export interface QueueStates {
  queued: string;
  active: string;
  completed: string;
  failed: string;
  /** Terminal state applications can set to prevent future claims. */
  cancelled: string;
}

export interface BackoffOptions {
  /** First retry delay in milliseconds. @default 5000 */
  initialMs?: number;
  /** Maximum retry delay in milliseconds. @default 300000 */
  maxMs?: number;
  /** Exponential growth factor. @default 2 */
  factor?: number;
  /** Random variation from 0 to 1. @default 0.1 */
  jitter?: number;
}

export interface RetryOptions {
  /** Override the configured backoff for this retry. */
  delayMs?: number;
}

export interface QueueControl {
  /** The 1-based execution attempt for this claim. */
  readonly attempt: number;
  /** The opaque fencing token held by this worker. */
  readonly leaseToken: string;
  /** Make the record available again without consuming an attempt. */
  defer(ms: number): Promise<boolean>;
  /** Make the record available again and consume an attempt. */
  retry(error?: unknown, options?: RetryOptions): Promise<boolean>;
  /** Extend this claim's lease. Returns false when the claim is no longer owned. */
  heartbeat(): Promise<boolean>;
  /** Mark the record completed if this worker still owns the claim. */
  complete(): Promise<boolean>;
  /** Mark the record failed if this worker still owns the claim. */
  fail(error?: unknown): Promise<boolean>;
}

export interface QueueEvents<TDocument extends object, TJob> {
  onClaim?(record: WithId<TDocument>, job: TJob): void | Promise<void>;
  onComplete?(record: WithId<TDocument>, job: TJob): void | Promise<void>;
  onRetry?(record: WithId<TDocument>, job: TJob, error: unknown): void | Promise<void>;
  onFail?(record: WithId<TDocument>, job: TJob, error: unknown): void | Promise<void>;
  onError?(error: unknown): void;
}

export interface QueueOptions<TDocument extends object, TJob> {
  /** MongoDB collection containing both domain data and queue metadata. */
  collection: Collection<TDocument>;
  /** Convert a claimed record into the value passed to the handler. */
  map(record: WithId<TDocument>): TJob;
  /** Process one claim. Returning normally completes it unless configured otherwise. */
  handler(job: TJob, control: QueueControl): Promise<void>;
  /** Additional eligibility filter evaluated for every atomic claim. */
  claimFilter?: Filter<TDocument> | (() => Filter<TDocument> | Promise<Filter<TDocument>>);
  /** Queue field-path overrides. */
  fields?: Partial<QueueFields>;
  /** Queue state-value overrides. */
  states?: Partial<QueueStates>;
  /** Claim order. @default availableAt ascending, then _id ascending */
  sort?: Sort;
  /** Lease-owner identifier. @default a generated ObjectId string */
  workerId?: string;
  /** Maximum number of concurrently running handlers. @default 1 */
  concurrency?: number;
  /** Poll interval in milliseconds. @default 1000 */
  pollIntervalMs?: number;
  /** Claim duration and heartbeat extension in milliseconds. @default 60000 */
  leaseDurationMs?: number;
  /** Attempt at which an unhandled error permanently fails the record. @default 3 */
  maxAttempts?: number;
  /** Exponential retry-delay configuration. */
  backoff?: BackoffOptions;
  /** Allow expired active records to be claimed again. @default true */
  reclaimExpired?: boolean;
  /**
   * `complete` gives conventional queue semantics. `release` only removes the
   * lease, for domain records whose handler advances state independently.
   */
  onReturn?: "complete" | "release";
  /** Optional worker lifecycle hooks. */
  events?: QueueEvents<TDocument, TJob>;
}

export interface QueueWorker {
  /** Identifier stored as the active lease owner. */
  readonly workerId: string;
  /** Stop polling and wait for all currently running handlers to settle. */
  close(): Promise<void>;
}

export type QueueRecordId<TDocument extends object> = InferIdType<TDocument>;
