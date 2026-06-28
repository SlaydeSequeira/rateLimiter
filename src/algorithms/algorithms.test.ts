import assert from "node:assert";
import { test } from "node:test";
import { getAlgorithm, listAlgorithms } from "./registry";
import { AlgorithmConfig, AlgorithmState } from "./types";

/** Fire `n` requests at a fixed instant and return how many were allowed. */
function burst(name: string, config: AlgorithmConfig, n: number, now = 1_000_000) {
  const algo = getAlgorithm(name);
  let state: AlgorithmState | null = null;
  let allowed = 0;
  for (let i = 0; i < n; i++) {
    const out = algo.consume({ state, config, cost: 1, now });
    if (out.decision.allowed) allowed++;
    state = out.state;
  }
  return allowed;
}

test("all four algorithms are registered", () => {
  assert.deepEqual(
    listAlgorithms().sort(),
    ["fixed_window", "leaky_bucket", "sliding_window", "token_bucket"]
  );
});

test("leaky_bucket allows up to capacity then denies", () => {
  const cfg: AlgorithmConfig = { algorithm: "leaky_bucket", capacity: 3, refillRatePerSec: 1 };
  assert.equal(burst("leaky_bucket", cfg, 5), 3);
});

test("fixed_window allows up to limit within a window then denies", () => {
  const cfg: AlgorithmConfig = { algorithm: "fixed_window", limit: 3, windowSec: 10 };
  assert.equal(burst("fixed_window", cfg, 5), 3);
});

test("fixed_window resets at the next window boundary", () => {
  const algo = getAlgorithm("fixed_window");
  const cfg: AlgorithmConfig = { algorithm: "fixed_window", limit: 2, windowSec: 10 };
  let state: AlgorithmState | null = null;
  for (let i = 0; i < 2; i++) state = algo.consume({ state, config: cfg, cost: 1, now: 0 }).state;
  // window exhausted at t=0
  assert.equal(algo.consume({ state, config: cfg, cost: 1, now: 0 }).decision.allowed, false);
  // ...allowed again after the window rolls over
  assert.equal(algo.consume({ state, config: cfg, cost: 1, now: 10_001 }).decision.allowed, true);
});

test("sliding_window allows up to limit then denies", () => {
  const cfg: AlgorithmConfig = { algorithm: "sliding_window", limit: 3, windowSec: 10 };
  assert.equal(burst("sliding_window", cfg, 5), 3);
});
