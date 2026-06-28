import {
  AlgorithmConfig,
  ConsumeInput,
  ConsumeOutput,
  RateLimitAlgorithm,
} from "./types";

/**
 * Sliding window counter (weighted approximation).
 *
 * Smooths out the fixed-window boundary burst by blending the current window's
 * count with a time-weighted fraction of the previous window's count. Allows up
 * to `limit` units across any rolling `windowSec` span. This is the well-known
 * Cloudflare-style approximation — accurate enough for rate limiting while
 * keeping state tiny (just two counters + a window start).
 */
export class SlidingWindowAlgorithm implements RateLimitAlgorithm {
  readonly name = "sliding_window";

  consume({ state, config, cost, now }: ConsumeInput): ConsumeOutput {
    const { limit, windowMs } = resolveConfig(config);

    let windowStart = state?.windowStart ?? now;
    let curr = state?.curr ?? 0;
    let prev = state?.prev ?? 0;

    // Advance the window(s) we've moved past since we last saw this client.
    const elapsedWindows = Math.floor((now - windowStart) / windowMs);
    if (elapsedWindows === 1) {
      prev = curr;
      curr = 0;
      windowStart += windowMs;
    } else if (elapsedWindows >= 2) {
      prev = 0;
      curr = 0;
      windowStart = now;
    }

    // Weighted estimate of usage across the rolling window.
    const intoWindow = (now - windowStart) / windowMs; // 0..1
    const weight = 1 - intoWindow;
    const estimate = curr + prev * weight;

    let allowed = false;
    if (estimate + cost <= limit) {
      curr += cost;
      allowed = true;
    }

    const usedAfter = allowed ? estimate + cost : estimate;
    const remaining = Math.max(0, Math.floor(limit - usedAfter));
    const resetMs = Math.max(0, Math.ceil(windowMs - (now - windowStart)));

    // When denied, estimate how long until the weighted count decays enough.
    let retryAfterMs = 0;
    if (!allowed) {
      const deficit = estimate + cost - limit;
      retryAfterMs =
        prev > 0 ? Math.min(resetMs, Math.ceil((deficit * windowMs) / prev)) : resetMs;
    }

    return {
      decision: { allowed, limit, remaining, resetMs, retryAfterMs },
      state: { curr, prev, windowStart },
      ttlMs: windowMs * 2 + 1000,
    };
  }
}

function resolveConfig(config: AlgorithmConfig): { limit: number; windowMs: number } {
  const limit = Number(config.limit ?? config.capacity ?? 100);
  const capacity = Number(config.capacity ?? 0);
  const rate = Number(config.refillRatePerSec ?? 0);
  const windowSec = Number(
    config.windowSec ?? (capacity > 0 && rate > 0 ? capacity / rate : 60)
  );
  if (!(limit > 0)) throw new Error("sliding_window: `limit` must be positive");
  if (!(windowSec > 0)) throw new Error("sliding_window: `windowSec` must be positive");
  return { limit, windowMs: windowSec * 1000 };
}
