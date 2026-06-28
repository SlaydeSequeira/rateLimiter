/**
 * Algorithm layer contracts.
 *
 * Every rate-limiting algorithm is a pure function of (previous state, config,
 * cost, now) -> (decision, next state). Keeping algorithms pure means the
 * storage layer and the HTTP layer never need to know which algorithm is in
 * use, and adding a new algorithm is just implementing this interface and
 * registering it. See ./registry.ts.
 */

/** Per-policy configuration. `algorithm` selects the strategy; the remaining
 *  fields are algorithm-specific. New algorithms can read their own keys. */
export interface AlgorithmConfig {
  algorithm: string;
  // token_bucket
  capacity?: number;
  refillRatePerSec?: number;
  // open-ended so future algorithms (sliding window, leaky bucket, ...) can
  // carry their own params without changing this type.
  [key: string]: unknown;
}

/** Opaque per-client state persisted between requests. Numbers only so it
 *  serializes trivially into any store. */
export type AlgorithmState = Record<string, number>;

export interface ConsumeInput {
  /** Previous persisted state, or null if this client has no state yet. */
  state: AlgorithmState | null;
  config: AlgorithmConfig;
  /** How many tokens/units this request costs. Usually 1. */
  cost: number;
  /** Current time in epoch ms. Passed in so algorithms stay pure/testable. */
  now: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** The effective limit (e.g. bucket capacity). */
  limit: number;
  /** Whole units remaining after this request. */
  remaining: number;
  /** ms until the limit is fully replenished. */
  resetMs: number;
  /** ms the caller should wait before retrying. 0 when allowed. */
  retryAfterMs: number;
}

export interface ConsumeOutput {
  decision: RateLimitDecision;
  /** State to persist for the next request. */
  state: AlgorithmState;
  /** Suggested TTL (ms) for the persisted state, so idle clients are evicted. */
  ttlMs: number;
}

export interface RateLimitAlgorithm {
  /** Stable identifier referenced by AlgorithmConfig.algorithm. */
  readonly name: string;
  consume(input: ConsumeInput): ConsumeOutput;
}
