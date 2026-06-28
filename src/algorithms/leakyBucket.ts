import {
  AlgorithmConfig,
  ConsumeInput,
  ConsumeOutput,
  RateLimitAlgorithm,
} from "./types";

/**
 * Leaky bucket (as a queue).
 *
 * Requests pour `cost` units of water into a bucket of size `capacity`; the
 * bucket leaks steadily at `refillRatePerSec`. A request is allowed only if it
 * fits without overflowing. This is the dual of the token bucket: it permits
 * bursts up to `capacity`, then enforces a smooth drain rate. `remaining` here
 * means free space left in the bucket.
 */
export class LeakyBucketAlgorithm implements RateLimitAlgorithm {
  readonly name = "leaky_bucket";

  consume({ state, config, cost, now }: ConsumeInput): ConsumeOutput {
    const { capacity, leakRatePerSec } = resolveConfig(config);

    let level = state?.level ?? 0;
    const lastLeak = state?.lastLeak ?? now;

    // Drain based on elapsed time.
    const elapsedSec = Math.max(0, (now - lastLeak) / 1000);
    level = Math.max(0, level - elapsedSec * leakRatePerSec);

    let allowed = false;
    if (level + cost <= capacity) {
      level += cost;
      allowed = true;
    }

    const remaining = Math.max(0, Math.floor(capacity - level));
    const overflow = allowed ? 0 : level + cost - capacity;
    const retryAfterMs =
      allowed || leakRatePerSec <= 0 ? 0 : Math.ceil((overflow / leakRatePerSec) * 1000);
    const resetMs = leakRatePerSec <= 0 ? 0 : Math.ceil((level / leakRatePerSec) * 1000);

    return {
      decision: { allowed, limit: capacity, remaining, resetMs, retryAfterMs },
      state: { level, lastLeak: now },
      ttlMs: resetMs + 1000,
    };
  }
}

function resolveConfig(config: AlgorithmConfig): { capacity: number; leakRatePerSec: number } {
  const capacity = Number(config.capacity ?? 100);
  const leakRatePerSec = Number(config.refillRatePerSec ?? 10);
  if (!(capacity > 0)) throw new Error("leaky_bucket: `capacity` must be positive");
  if (!(leakRatePerSec >= 0)) throw new Error("leaky_bucket: `refillRatePerSec` must be >= 0");
  return { capacity, leakRatePerSec };
}
