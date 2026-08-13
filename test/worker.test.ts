import assert from "node:assert/strict";
import test from "node:test";
import type { Collection, Filter, UpdateFilter, WithId } from "mongodb";
import { createQueueWorker } from "../src/index.js";

interface RecordUnderTest {
  _id: number;
  value: string;
  queue: {
    state: string;
    availableAt: Date;
    attempt: number;
    lease?: { token?: string; owner?: string; expiresAt?: Date };
    completedAt?: Date;
    updatedAt?: Date;
  };
}

function get(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) => (
    value && typeof value === "object"
      ? (value as Record<string, unknown>)[part]
      : undefined
  ), source);
}

function set(target: object, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = target as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    const child = cursor[part];
    if (!child || typeof child !== "object") cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = value;
}

function unset(target: object, path: string): void {
  const parts = path.split(".");
  const parent = get(target, parts.slice(0, -1).join("."));
  if (parent && typeof parent === "object") {
    delete (parent as Record<string, unknown>)[parts.at(-1)!];
  }
}

function matches(record: object, filter: Record<string, unknown>): boolean {
  if (filter.$and) {
    return (filter.$and as Record<string, unknown>[]).every(item => matches(record, item));
  }
  if (filter.$or) {
    return (filter.$or as Record<string, unknown>[]).some(item => matches(record, item));
  }
  return Object.entries(filter).every(([path, expected]) => {
    const actual = get(record, path);
    if (expected && typeof expected === "object" && "$lte" in expected) {
      return actual instanceof Date && actual <= (expected as { $lte: Date }).$lte;
    }
    return actual === expected;
  });
}

class FakeCollection {
  constructor(readonly record: RecordUnderTest) {}

  async findOneAndUpdate(
    filter: Filter<RecordUnderTest>,
    update: UpdateFilter<RecordUnderTest>,
  ): Promise<WithId<RecordUnderTest> | null> {
    if (!matches(this.record, filter as Record<string, unknown>)) return null;
    this.apply(update);
    return structuredClone(this.record) as WithId<RecordUnderTest>;
  }

  async updateOne(
    filter: Filter<RecordUnderTest>,
    update: UpdateFilter<RecordUnderTest>,
  ): Promise<{ modifiedCount: number }> {
    if (!matches(this.record, filter as Record<string, unknown>)) return { modifiedCount: 0 };
    this.apply(update);
    return { modifiedCount: 1 };
  }

  private apply(update: UpdateFilter<RecordUnderTest>): void {
    for (const [path, value] of Object.entries(update.$set ?? {})) set(this.record, path, value);
    for (const path of Object.keys(update.$unset ?? {})) unset(this.record, path);
    for (const [path, amount] of Object.entries(update.$inc ?? {})) {
      set(this.record, path, Number(get(this.record, path) ?? 0) + Number(amount));
    }
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for worker transition");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test("worker atomically claims and completes the same domain record", async () => {
  const record: RecordUnderTest = {
    _id: 1,
    value: "work",
    queue: { state: "queued", availableAt: new Date(0), attempt: 0 },
  };
  const collection = new FakeCollection(record);
  let observedLease = "";

  const worker = createQueueWorker({
    collection: collection as unknown as Collection<RecordUnderTest>,
    pollIntervalMs: 10,
    leaseDurationMs: 1_000,
    map: claimed => claimed.value,
    handler: async (value, control) => {
      assert.equal(value, "work");
      observedLease = control.leaseToken;
    },
  });

  await waitFor(() => record.queue.state === "completed");
  await worker.close();

  assert.ok(observedLease);
  assert.equal(record.queue.attempt, 0);
  assert.ok(record.queue.completedAt instanceof Date);
  assert.equal(record.queue.lease?.token, undefined);
});

test("defer releases the lease without consuming an attempt", async () => {
  const record: RecordUnderTest = {
    _id: 2,
    value: "later",
    queue: { state: "queued", availableAt: new Date(0), attempt: 0 },
  };
  const collection = new FakeCollection(record);
  const before = Date.now();

  const worker = createQueueWorker({
    collection: collection as unknown as Collection<RecordUnderTest>,
    pollIntervalMs: 10,
    leaseDurationMs: 1_000,
    map: claimed => claimed.value,
    handler: async (_value, control) => {
      await control.defer(60_000);
    },
  });

  await waitFor(() => record.queue.availableAt.getTime() > before + 50_000);
  await worker.close();

  assert.equal(record.queue.state, "queued");
  assert.equal(record.queue.attempt, 0);
  assert.equal(record.queue.lease?.token, undefined);
});
