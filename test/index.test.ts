import assert from "node:assert/strict";
import test from "node:test";
import { recommendedClaimIndexes } from "../src/index.js";

test("recommendedClaimIndexes follow custom paths", () => {
  assert.deepEqual(
    recommendedClaimIndexes({
      state: "status",
      availableAt: "runAfter",
      leaseExpiresAt: "lease.until",
    }),
    [
      { status: 1, runAfter: 1 },
      { status: 1, "lease.until": 1 },
    ],
  );
});
