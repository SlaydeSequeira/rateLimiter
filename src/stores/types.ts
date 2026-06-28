import { AlgorithmState } from "../algorithms/types";

/**
 * Storage layer contract.
 *
 * A store persists per-client algorithm state and serializes read-modify-write
 * cycles per key so concurrent requests for the same client don't race.
 *
 * Implementations:
 *   - MemoryStore: single-instance, zero-dependency (default).
 *   - RedisStore:  shared across instances (enable with REDIS_URL).
 * Adding another backend (DynamoDB, Postgres, ...) is just implementing this.
 */
export interface RateLimitStore {
  get(key: string): Promise<AlgorithmState | null>;
  set(key: string, state: AlgorithmState, ttlMs: number): Promise<void>;
  /** Run `fn` while holding a per-key lock, to keep get->compute->set atomic. */
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
  /** Best-effort health check used by /healthz. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}
