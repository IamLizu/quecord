# Quecord

[![npm version](https://img.shields.io/npm/v/quecord.svg)](https://www.npmjs.com/package/quecord)
[![CI](https://github.com/IamLizu/quecord/actions/workflows/ci.yml/badge.svg)](https://github.com/IamLizu/quecord/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/quecord.svg)](https://www.npmjs.com/package/quecord)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Your record is the job.**

Quecord is a small MongoDB-native durable work queue for Node.js. It claims and
executes existing records in place, so queue state and domain state do not have
to live in separate collections.

## Why Quecord

- Atomic claims using MongoDB `findOneAndUpdate`
- Lease tokens that fence stale workers
- Lease heartbeats and optional expired-lease recovery
- Delayed work and non-failure deferral
- Automatic retries with exponential backoff and jitter
- Explicit retry, fail, complete, and heartbeat controls
- Configurable concurrency and graceful draining
- Configurable field paths and state names
- No runtime dependency beyond the official MongoDB driver
- ESM and CommonJS support, with bundled TypeScript declarations

Quecord provides at-least-once execution. Handlers that perform external side
effects should still use idempotency keys. Lease fencing protects queue-state
transitions; it cannot undo an external request made by a worker that later
loses its lease.

## Requirements

- Node.js 20 or newer
- MongoDB driver 6 or 7
- A MongoDB deployment supported by the installed driver

## Install

```sh
npm install quecord mongodb
```

Quecord supports both JavaScript module systems:

```js
// ESM
import { createQueueWorker } from "quecord";

// CommonJS
const { createQueueWorker } = require("quecord");
```

TypeScript is not required. The published package contains ready-to-run
JavaScript, with type declarations included for editors and TypeScript users.

## Quick start

The default schema stores queue metadata under `queue` on the domain record:

```ts
interface EmailRecord {
  to: string;
  subject: string;
  queue: {
    state: "queued" | "active" | "completed" | "failed";
    availableAt: Date;
    attempt: number;
  };
}
```

Create a worker over the existing collection:

```ts
import { MongoClient } from "mongodb";
import { createQueueWorker } from "quecord";

const client = new MongoClient(process.env.MONGODB_URI!);
await client.connect();

const emails = client.db().collection<EmailRecord>("emails");

const worker = createQueueWorker({
  collection: emails,
  concurrency: 10,
  map: record => ({ id: record._id, to: record.to, subject: record.subject }),
  handler: async email => {
    await sendEmail(email);
  },
});

process.on("SIGTERM", async () => {
  await worker.close();
  await client.close();
});
```

Insert a domain record already marked as queued:

```ts
await emails.insertOne({
  to: "person@example.com",
  subject: "Welcome",
  queue: {
    state: "queued",
    availableAt: new Date(),
    attempt: 0,
  },
});
```

Quecord adds lease fields while the record is active and removes them when the
claim is settled.

## Handler controls

```ts
const worker = createQueueWorker({
  collection,
  map: record => record,
  handler: async (record, control) => {
    if (await dependencyIsBusy()) {
      await control.defer(30_000); // does not consume an attempt
      return;
    }

    try {
      await performWork(record);
    } catch (error) {
      await control.retry(error, { delayMs: 10_000 });
    }
  },
});
```

Available controls:

- `defer(ms)` — requeue after `ms` without incrementing the attempt count
- `retry(error, options)` — requeue and increment the attempt count; an
  optional `delayMs` overrides the configured backoff for that retry
- `heartbeat()` — extend the lease by `leaseDurationMs`
- `complete()` — mark the record completed
- `fail(error)` — mark the record failed and store the error message

Every transition returns `false` if the worker no longer owns the lease.
Calling another control after a successful transition also returns `false`.

Quecord does not heartbeat automatically. A handler that can run longer than
`leaseDurationMs` should call `heartbeat()` periodically, normally around every
half lease duration. Stop work if it returns `false`, because another worker may
have reclaimed the record:

```js
const timer = setInterval(async () => {
  if (!(await control.heartbeat())) {
    clearInterval(timer);
    abortController.abort();
  }
}, leaseDurationMs / 2);

try {
  await performLongRunningWork({ signal: abortController.signal });
} finally {
  clearInterval(timer);
}
```

## API reference

### `createQueueWorker(options)`

Creates a worker and starts polling immediately. It returns a `QueueWorker`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `collection` | MongoDB `Collection` | required | Collection containing the domain records and queue fields. |
| `map` | `(record) => job` | required | Converts the claimed MongoDB record into the value passed to `handler`. |
| `handler` | `async (job, control) => void` | required | Performs the work for one claim. |
| `claimFilter` | MongoDB filter or async filter factory | `{}` | Adds eligibility conditions to every atomic claim. |
| `fields` | partial `QueueFields` | default paths below | Maps queue metadata onto an existing schema. |
| `states` | partial `QueueStates` | default values below | Maps Quecord states onto existing state values. |
| `sort` | MongoDB sort | available time, then `_id` | Chooses which eligible record is claimed first. |
| `workerId` | `string` | generated ObjectId string | Identifies the lease owner for observability. |
| `concurrency` | `number` | `1` | Maximum claims handled concurrently by this worker. |
| `pollIntervalMs` | `number` | `1000` | Delay between polling attempts; minimum `10`. |
| `leaseDurationMs` | `number` | `60000` | Duration of a claim or heartbeat extension; minimum `100`. |
| `maxAttempts` | `number` | `3` | Execution attempt at which an unhandled error becomes a permanent failure. |
| `backoff` | `BackoffOptions` | values below | Retry-delay configuration for unhandled errors and `retry()`. |
| `reclaimExpired` | `boolean` | `true` | Allows an expired active record to be claimed again. |
| `onReturn` | `"complete" \| "release"` | `"complete"` | Controls what happens when a handler returns without settling explicitly. |
| `events` | `QueueEvents` | none | Optional claim, completion, retry, failure, and worker-error hooks. |

Invalid concurrency, polling, lease, or attempt values throw synchronously when
the worker is created. A `claimFilter` factory is evaluated before every claim,
so it can use current tenant, feature-flag, or throttling state.

### Default fields

| Field | Default path |
| --- | --- |
| `state` | `queue.state` |
| `availableAt` | `queue.availableAt` |
| `attempt` | `queue.attempt` |
| `leaseToken` | `queue.lease.token` |
| `leaseOwner` | `queue.lease.owner` |
| `leaseExpiresAt` | `queue.lease.expiresAt` |
| `lastError` | `queue.lastError` |
| `completedAt` | `queue.completedAt` |
| `failedAt` | `queue.failedAt` |
| `updatedAt` | `queue.updatedAt` |

The default state values are `queued`, `active`, `completed`, `failed`, and
`cancelled`. Quecord never claims a cancelled record. Cancellation is controlled
by the consuming application because requests to cancel normally originate
outside the running handler.

To cancel a queued or active record with the default fields, change its state
and clear its lease in one update:

```js
await collection.updateOne(
  {
    _id: recordId,
    "queue.state": { $in: ["queued", "active"] },
  },
  {
    $set: {
      "queue.state": "cancelled",
      "queue.updatedAt": new Date(),
    },
    $unset: {
      "queue.lease.token": "",
      "queue.lease.owner": "",
      "queue.lease.expiresAt": "",
    },
  },
);
```

Changing an active record to cancelled fences its worker from completing,
retrying, or failing the record because it no longer owns an active lease. It
cannot interrupt JavaScript already running inside the handler or undo an
external side effect. Handlers that need prompt cooperative cancellation should
check application state between steps or use an application-managed abort
signal.

### Retry backoff

| Option | Default | Description |
| --- | --- | --- |
| `initialMs` | `5000` | Delay for the first retry. |
| `maxMs` | `300000` | Maximum delay. |
| `factor` | `2` | Exponential growth factor. |
| `jitter` | `0.1` | Random variation from `0` to `1`, applied above and below the base delay. |

The handler's `control.attempt` is one-based. The stored attempt field counts
consumed retries: a new record normally starts at `0`, the first execution sees
attempt `1`, and `retry()` increments the stored value.

### Events

`onClaim`, `onComplete`, `onRetry`, and `onFail` receive the claimed record and
mapped job. Retry and failure hooks also receive the error. `onError` receives
errors from polling or unexpected worker execution failures. Without `onError`,
such errors are written to `console.error`.

### `recommendedClaimIndexes(fields?)`

Returns the two index specifications used by normal queued claims and expired
lease reclamation. Pass the same field overrides used by the worker.

### `worker.workerId`

The configured or generated worker identifier stored in `leaseOwner` while a
record is active.

### `worker.close()`

Stops new polling and waits for every currently running handler to settle. It
does not cancel handlers, release their leases early, close the MongoDB client,
or impose a timeout. Your shutdown handler should await `worker.close()` before
closing MongoDB. Long-running handlers should support application-level
cancellation if shutdown must have a deadline.

## Existing schemas

Field paths and state values can map Quecord onto an existing domain model:

```ts
createQueueWorker({
  collection,
  fields: {
    state: "status",
    availableAt: "runAfter",
    attempt: "attempts",
    leaseToken: "workerLease.token",
    leaseOwner: "workerLease.owner",
    leaseExpiresAt: "workerLease.expiresAt",
    lastError: "error",
    updatedAt: "updatedAt",
  },
  states: {
    queued: "pending",
    active: "processing",
    completed: "done",
    failed: "failed",
  },
  map: record => record,
  handler: processRecord,
});
```

`claimFilter` can restrict eligible records, for example by tenant or parent
workflow. It may be asynchronous and is evaluated before every claim.

## Claim index

For the default schema:

```ts
import { recommendedClaimIndexes } from "quecord";

for (const index of recommendedClaimIndexes()) {
  await collection.createIndex(index);
}
```

For a custom schema, pass the same field mapping:

```ts
for (const index of recommendedClaimIndexes(fields)) {
  await collection.createIndex(index);
}
```

If `claimFilter` consistently uses equality fields, put those fields before the
Quecord fields in a compound index and validate the final shape with `explain()`.

## Return behavior

By default, a handler that returns without calling a control is completed.
Set `onReturn: "release"` when the domain handler owns its state machine and
Quecord should only release the lease after a successful return. In release
mode, the handler must move the record out of the active state itself, ideally
in a write guarded by `control.leaseToken`. Quecord then removes the lease fields
and updates `updatedAt`, but does not change the state. Returning while the
record is still active leaves it ineligible until application code changes it.

## Delivery guarantees

Quecord intentionally promises at-least-once execution:

- An expired active lease can be reclaimed when `reclaimExpired` is enabled.
- A worker that no longer owns its lease cannot settle the record.
- External side effects require application-level idempotency.
- Set `reclaimExpired: false` when an external system cannot safely accept a
  repeated request and recovery is handled by a domain-specific reconciler.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

## Releasing

Publishing is triggered by publishing a GitHub Release. The release tag must be
valid SemVer, optionally prefixed with `v`, and must exactly match the version
in `package.json`. For example, package version `1.2.3` accepts tags `1.2.3` and
`v1.2.3`.

Stable versions publish with the npm `latest` tag. SemVer prereleases such as
`v1.2.3-beta.1` publish with the npm `next` tag. 

## License

MIT © IamLizu
