import { getAlgorithm } from "../algorithms/registry";
import { AlgorithmConfig, RateLimitDecision } from "../algorithms/types";
import { RateLimitStore } from "../stores/types";

export interface RateLimiterOptions {
  store: RateLimitStore;
  /** Namespaces keys so multiple services can share one store. */
  keyPrefix?: string;
}

/**
 * Orchestrates a rate-limit check: load state -> run the configured algorithm
 * -> persist new state, all under a per-key lock. Knows nothing about which
 * algorithm or store is in use — both are pluggable.
 */
export class RateLimiter {
  private readonly store: RateLimitStore;
  private readonly keyPrefix: string;

  constructor(options: RateLimiterOptions) {
    this.store = options.store;
    this.keyPrefix = options.keyPrefix ?? "rl";
  }

  async check(
    clientId: string,
    policy: AlgorithmConfig,
    cost = 1
  ): Promise<RateLimitDecision> {
    const algorithm = getAlgorithm(policy.algorithm);
    const key = `${this.keyPrefix}:${policy.algorithm}:${clientId}`;

    return this.store.withLock(key, async () => {
      const state = await this.store.get(key);
      const { decision, state: nextState, ttlMs } = algorithm.consume({
        state,
        config: policy,
        cost,
        now: Date.now(),
      });
      await this.store.set(key, nextState, ttlMs);
      return decision;
    });
  }
}
