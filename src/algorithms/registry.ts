import { RateLimitAlgorithm } from "./types";
import { TokenBucketAlgorithm } from "./tokenBucket";
import { LeakyBucketAlgorithm } from "./leakyBucket";
import { FixedWindowAlgorithm } from "./fixedWindow";
import { SlidingWindowAlgorithm } from "./slidingWindow";

/**
 * Algorithm registry.
 *
 * To add a new algorithm later:
 *   1. Implement RateLimitAlgorithm (see tokenBucket.ts as a template).
 *   2. Register it below, e.g. registerAlgorithm(new SlidingWindowAlgorithm()).
 *   3. Reference it from a policy via `"algorithm": "<its name>"`.
 * No other layer needs to change.
 */
const registry = new Map<string, RateLimitAlgorithm>();

export function registerAlgorithm(algorithm: RateLimitAlgorithm): void {
  registry.set(algorithm.name, algorithm);
}

export function getAlgorithm(name: string): RateLimitAlgorithm {
  const algorithm = registry.get(name);
  if (!algorithm) {
    throw new Error(
      `Unknown rate-limit algorithm "${name}". Registered: ${listAlgorithms().join(", ")}`
    );
  }
  return algorithm;
}

export function listAlgorithms(): string[] {
  return [...registry.keys()];
}

// --- Built-in algorithms ---
registerAlgorithm(new TokenBucketAlgorithm());
registerAlgorithm(new LeakyBucketAlgorithm());
registerAlgorithm(new FixedWindowAlgorithm());
registerAlgorithm(new SlidingWindowAlgorithm());
