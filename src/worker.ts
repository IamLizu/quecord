import {
  ObjectId,
  type Document,
  type Filter,
  type InferIdType,
  type Sort,
  type UpdateFilter,
  type WithId,
} from "mongodb";
import type {
  BackoffOptions,
  QueueControl,
  QueueFields,
  QueueOptions,
  QueueStates,
  QueueWorker,
} from "./types.js";

const DEFAULT_FIELDS: QueueFields = {
  state: "queue.state",
  availableAt: "queue.availableAt",
  attempt: "queue.attempt",
  leaseToken: "queue.lease.token",
  leaseOwner: "queue.lease.owner",
  leaseExpiresAt: "queue.lease.expiresAt",
  lastError: "queue.lastError",
  completedAt: "queue.completedAt",
  failedAt: "queue.failedAt",
  updatedAt: "queue.updatedAt",
};

const DEFAULT_STATES: QueueStates = {
  queued: "queued",
  active: "active",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

const DEFAULT_BACKOFF: Required<BackoffOptions> = {
  initialMs: 5_000,
  maxMs: 5 * 60_000,
  factor: 2,
  jitter: 0.1,
};

function readPath(source: unknown, path: string): unknown {
  let value = source;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? "Unknown queue error";
  } catch {
    return "Unknown queue error";
  }
}

export function backoffDelay(
  attempt: number,
  options: BackoffOptions = {},
  random: () => number = Math.random,
): number {
  const config = { ...DEFAULT_BACKOFF, ...options };
  const base = Math.min(
    config.maxMs,
    config.initialMs * config.factor ** Math.max(0, attempt - 1),
  );
  const spread = base * Math.max(0, Math.min(1, config.jitter));
  return Math.max(0, Math.round(base - spread + random() * spread * 2));
}

export function recommendedClaimIndexes(
  fields: Partial<QueueFields> = {},
): Array<Record<string, 1>> {
  const resolved = { ...DEFAULT_FIELDS, ...fields };
  return [
    { [resolved.state]: 1, [resolved.availableAt]: 1 },
    { [resolved.state]: 1, [resolved.leaseExpiresAt]: 1 },
  ];
}

export function createQueueWorker<TDocument extends object, TJob>(
  options: QueueOptions<TDocument, TJob>,
): QueueWorker {
  const fields = { ...DEFAULT_FIELDS, ...options.fields };
  const states = { ...DEFAULT_STATES, ...options.states };
  const workerId = options.workerId ?? new ObjectId().toHexString();
  const concurrency = options.concurrency ?? 1;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const leaseDurationMs = options.leaseDurationMs ?? 60_000;
  const maxAttempts = options.maxAttempts ?? 3;
  const onReturn = options.onReturn ?? "complete";
  const reclaimExpired = options.reclaimExpired ?? true;
  const sort: Sort = options.sort ?? { [fields.availableAt]: 1, _id: 1 };

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 10) {
    throw new RangeError("pollIntervalMs must be at least 10ms");
  }
  if (!Number.isFinite(leaseDurationMs) || leaseDurationMs < 100) {
    throw new RangeError("leaseDurationMs must be at least 100ms");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }

  let stopped = false;
  let pumping = false;
  let inFlight = 0;
  const running = new Set<Promise<void>>();

  const notifyError = (error: unknown): void => {
    if (options.events?.onError) options.events.onError(error);
    else console.error("[quecord]", error);
  };

  async function extraFilter(): Promise<Filter<TDocument>> {
    if (!options.claimFilter) return {};
    return typeof options.claimFilter === "function"
      ? options.claimFilter()
      : options.claimFilter;
  }

  async function claim(): Promise<{ record: WithId<TDocument>; leaseToken: string } | null> {
    const now = new Date();
    const leaseToken = new ObjectId().toHexString();
    const eligible: Document[] = [
      {
        [fields.state]: states.queued,
        [fields.availableAt]: { $lte: now },
      },
    ];
    if (reclaimExpired) {
      eligible.push({
        [fields.state]: states.active,
        [fields.leaseExpiresAt]: { $lte: now },
      });
    }
    const filter = await extraFilter();
    const query = {
      $and: [filter, { $or: eligible }],
    } as Filter<TDocument>;
    const update = {
      $set: {
        [fields.state]: states.active,
        [fields.leaseToken]: leaseToken,
        [fields.leaseOwner]: workerId,
        [fields.leaseExpiresAt]: new Date(now.getTime() + leaseDurationMs),
        [fields.updatedAt]: now,
      },
    } as UpdateFilter<TDocument>;
    const record = await options.collection.findOneAndUpdate(query, update, {
      sort,
      returnDocument: "after",
    });
    return record ? { record, leaseToken } : null;
  }

  function ownedFilter(
    id: InferIdType<TDocument>,
    leaseToken: string,
  ): Filter<TDocument> {
    return {
      _id: id,
      [fields.state]: states.active,
      [fields.leaseToken]: leaseToken,
    } as Filter<TDocument>;
  }

  function tokenFilter(
    id: InferIdType<TDocument>,
    leaseToken: string,
  ): Filter<TDocument> {
    return {
      _id: id,
      [fields.leaseToken]: leaseToken,
    } as Filter<TDocument>;
  }

  async function run(claimed: { record: WithId<TDocument>; leaseToken: string }): Promise<void> {
    const { record, leaseToken } = claimed;
    const id = record._id as InferIdType<TDocument>;
    const storedAttempt = readPath(record, fields.attempt);
    const attempt = typeof storedAttempt === "number" ? storedAttempt + 1 : 1;
    const job = options.map(record);
    let settled = false;

    const transition = async (update: UpdateFilter<TDocument>): Promise<boolean> => {
      const result = await options.collection.updateOne(ownedFilter(id, leaseToken), update);
      if (result.modifiedCount > 0) settled = true;
      return result.modifiedCount > 0;
    };

    const clearLease = {
      [fields.leaseToken]: "",
      [fields.leaseOwner]: "",
      [fields.leaseExpiresAt]: "",
    };

    const control: QueueControl = {
      attempt,
      leaseToken,
      async defer(ms) {
        const now = new Date();
        return transition({
          $set: {
            [fields.state]: states.queued,
            [fields.availableAt]: new Date(now.getTime() + Math.max(0, ms)),
            [fields.updatedAt]: now,
          },
          $unset: clearLease,
        } as UpdateFilter<TDocument>);
      },
      async retry(error, retryOptions) {
        const now = new Date();
        const delay = retryOptions?.delayMs ?? backoffDelay(attempt, options.backoff);
        const ok = await transition({
          $set: {
            [fields.state]: states.queued,
            [fields.availableAt]: new Date(now.getTime() + Math.max(0, delay)),
            [fields.lastError]: errorMessage(error),
            [fields.updatedAt]: now,
          },
          $inc: { [fields.attempt]: 1 },
          $unset: clearLease,
        } as UpdateFilter<TDocument>);
        if (ok) await options.events?.onRetry?.(record, job, error);
        return ok;
      },
      async heartbeat() {
        const now = new Date();
        const result = await options.collection.updateOne(ownedFilter(id, leaseToken), {
          $set: {
            [fields.leaseExpiresAt]: new Date(now.getTime() + leaseDurationMs),
            [fields.updatedAt]: now,
          },
        } as UpdateFilter<TDocument>);
        return result.modifiedCount > 0;
      },
      async complete() {
        const now = new Date();
        const ok = await transition({
          $set: {
            [fields.state]: states.completed,
            [fields.completedAt]: now,
            [fields.updatedAt]: now,
          },
          $unset: clearLease,
        } as UpdateFilter<TDocument>);
        if (ok) await options.events?.onComplete?.(record, job);
        return ok;
      },
      async fail(error) {
        const now = new Date();
        const ok = await transition({
          $set: {
            [fields.state]: states.failed,
            [fields.failedAt]: now,
            [fields.lastError]: errorMessage(error),
            [fields.updatedAt]: now,
          },
          $unset: clearLease,
        } as UpdateFilter<TDocument>);
        if (ok) await options.events?.onFail?.(record, job, error);
        return ok;
      },
    };

    try {
      await options.events?.onClaim?.(record, job);
      await options.handler(job, control);
      if (settled) return;
      if (onReturn === "complete") {
        await control.complete();
      } else {
        const result = await options.collection.updateOne(tokenFilter(id, leaseToken), {
          $unset: clearLease,
          $set: { [fields.updatedAt]: new Date() },
        } as UpdateFilter<TDocument>);
        if (result.modifiedCount > 0) settled = true;
      }
    } catch (error) {
      if (settled) return;
      if (attempt >= maxAttempts) await control.fail(error);
      else await control.retry(error);
    }
  }

  async function pump(): Promise<void> {
    if (stopped || pumping) return;
    pumping = true;
    try {
      while (!stopped && inFlight < concurrency) {
        const claimed = await claim();
        if (!claimed) break;
        inFlight++;
        const task = run(claimed)
          .catch(notifyError)
          .finally(() => {
            inFlight--;
            running.delete(task);
            if (!stopped) void pump();
          });
        running.add(task);
      }
    } catch (error) {
      notifyError(error);
    } finally {
      pumping = false;
    }
  }

  const poller = setInterval(() => void pump(), pollIntervalMs);
  poller.unref?.();
  void pump();

  return {
    workerId,
    async close(): Promise<void> {
      stopped = true;
      clearInterval(poller);
      await Promise.allSettled(running);
    },
  };
}
