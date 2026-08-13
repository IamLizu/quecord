import assert from "node:assert/strict";
import test from "node:test";
import { backoffDelay } from "../src/worker.js";

test("backoff grows exponentially and respects its cap", () => {
  const options = { initialMs: 100, maxMs: 350, factor: 2, jitter: 0 };
  assert.equal(backoffDelay(1, options), 100);
  assert.equal(backoffDelay(2, options), 200);
  assert.equal(backoffDelay(3, options), 350);
  assert.equal(backoffDelay(8, options), 350);
});

test("backoff jitter stays inside the configured range", () => {
  const options = { initialMs: 1_000, jitter: 0.2 };
  assert.equal(backoffDelay(1, options, () => 0), 800);
  assert.equal(backoffDelay(1, options, () => 0.5), 1_000);
  assert.equal(backoffDelay(1, options, () => 1), 1_200);
});
