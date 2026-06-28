import {
  AlgorithmConfig,
  ConsumeInput,
  ConsumeOutput,
  RateLimitAlgorithm,
} from "./types";

/**
 * Token bucket.
 *
 * A bucket holds up to `capacity` tokens and refills continuously at
 * `refillRatePerSec`. A request consuming `cost` tokens is allowed when the
 * bucket holds at least that many; otherwise it is rejected and the caller is
 * told how long until enough tokens accumulate.
 *
 * This allows short bursts (up to capacity) while bounding the long-run rate.
 */
export class TokenBucketAlgorithm implements RateLimitAlgorithm {
  readonly name = "token_bucket";

  consume({ state, config, cost, now }: ConsumeInput): ConsumeOutput {
    const { capacity, refillRatePerSec } = resolveConfig(config);

    // Start full the first time we see a client.
    let tokens = state?.tokens ?? capacity;
    const lastRefill = state?.lastRefill ?? now;

    // Replenish based on elapsed time, capped at capacity.
    const elapsedSec = Math.max(0, (now - lastRefill) / 1000);
    tokens = Math.min(capacity, tokens + elapsedSec * refillRatePerSec);

    let allowed = false;
    if (tokens >= cost) {
      tokens -= cost;
      allowed = true;
    }

    const remaining = Math.max(0, Math.floor(tokens));
    const deficit = allowed ? 0 : cost - tokens;
    const retryAfterMs =
      allowed || refillRatePerSec <= 0
        ? 0
        : Math.ceil((deficit / refillRatePerSec) * 1000);
    const resetMs =
      refillRatePerSec <= 0
        ? 0
        : Math.ceil(((capacity - tokens) / refillRatePerSec) * 1000);

    return {
      decision: { allowed, limit: capacity, remaining, resetMs, retryAfterMs },
      state: { tokens, lastRefill: now },
      // Keep state around at least until the bucket would be full again.
      ttlMs: resetMs + 1000,
    };
  }
}

function resolveConfig(config: AlgorithmConfig): {
  capacity: number;
  refillRatePerSec: number;
} {
  const capacity = Number(config.capacity ?? 100);
  const refillRatePerSec = Number(config.refillRatePerSec ?? 10);
  if (!(capacity > 0)) {
    throw new Error("token_bucket: `capacity` must be a positive number");
  }
  if (!(refillRatePerSec >= 0)) {
    throw new Error("token_bucket: `refillRatePerSec` must be >= 0");
  }
  return { capacity, refillRatePerSec };
}
