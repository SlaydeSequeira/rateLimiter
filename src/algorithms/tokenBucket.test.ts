import assert from "node:assert";
import { test } from "node:test";
import { TokenBucketAlgorithm } from "./tokenBucket";
import { AlgorithmConfig, AlgorithmState } from "./types";

const config: AlgorithmConfig = {
  algorithm: "token_bucket",
  capacity: 2,
  refillRatePerSec: 1,
};

test("allows bursts up to capacity, then blocks", () => {
  const algo = new TokenBucketAlgorithm();
  const now = 1_000_000;
  let state: AlgorithmState | null = null;

  let out = algo.consume({ state, config, cost: 1, now });
  assert.equal(out.decision.allowed, true);
  assert.equal(out.decision.remaining, 1);

  state = out.state;
  out = algo.consume({ state, config, cost: 1, now });
  assert.equal(out.decision.allowed, true);
  assert.equal(out.decision.remaining, 0);

  state = out.state;
  out = algo.consume({ state, config, cost: 1, now });
  assert.equal(out.decision.allowed, false);
  assert.ok(out.decision.retryAfterMs > 0);
});

test("refills tokens over elapsed time", () => {
  const algo = new TokenBucketAlgorithm();
  // Empty bucket at t=0, then 1s later one token should be back.
  const out = algo.consume({
    state: { tokens: 0, lastRefill: 0 },
    config,
    cost: 1,
    now: 1000,
  });
  assert.equal(out.decision.allowed, true);
});

test("never exceeds capacity when idle for a long time", () => {
  const algo = new TokenBucketAlgorithm();
  const out = algo.consume({
    state: { tokens: 0, lastRefill: 0 },
    config,
    cost: 1,
    now: 10_000_000,
  });
  assert.equal(out.decision.allowed, true);
  // capacity 2, consumed 1 -> at most 1 remaining
  assert.equal(out.decision.remaining, 1);
});
