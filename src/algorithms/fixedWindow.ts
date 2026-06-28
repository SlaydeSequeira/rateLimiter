import {
  AlgorithmConfig,
  ConsumeInput,
  ConsumeOutput,
  RateLimitAlgorithm,
} from "./types";

/**
 * Fixed window counter.
 *
 * Time is sliced into fixed windows of `windowSec`. Each window allows up to
 * `limit` units; the counter resets to zero at every window boundary. Simple
 * and cheap, but allows up to 2x `limit` across a boundary (the classic
 * fixed-window burst).
 */
export class FixedWindowAlgorithm implements RateLimitAlgorithm {
  readonly name = "fixed_window";

  consume({ state, config, cost, now }: ConsumeInput): ConsumeOutput {
    const { limit, windowMs } = resolveConfig(config);

    let windowStart = state?.windowStart ?? now;
    let count = state?.count ?? 0;

    // Roll over to a fresh window if the current one has elapsed.
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }

    let allowed = false;
    if (count + cost <= limit) {
      count += cost;
      allowed = true;
    }

    const remaining = Math.max(0, limit - count);
    const resetMs = Math.max(0, windowStart + windowMs - now);
    const retryAfterMs = allowed ? 0 : resetMs; // must wait for the next window

    return {
      decision: { allowed, limit, remaining, resetMs, retryAfterMs },
      state: { count, windowStart },
      ttlMs: resetMs + 1000,
    };
  }
}

function resolveConfig(config: AlgorithmConfig): { limit: number; windowMs: number } {
  const limit = Number(config.limit ?? config.capacity ?? 100);
  const windowSec = Number(config.windowSec ?? deriveWindowSec(config));
  if (!(limit > 0)) throw new Error("fixed_window: `limit` must be positive");
  if (!(windowSec > 0)) throw new Error("fixed_window: `windowSec` must be positive");
  return { limit, windowMs: windowSec * 1000 };
}

/** Fall back to a window derived from capacity/rate so a single set of
 *  controls (capacity + refill) maps sensibly onto window algorithms. */
function deriveWindowSec(config: AlgorithmConfig): number {
  const capacity = Number(config.capacity ?? 0);
  const rate = Number(config.refillRatePerSec ?? 0);
  return capacity > 0 && rate > 0 ? capacity / rate : 60;
}
