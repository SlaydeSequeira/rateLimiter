import { AlgorithmState } from "../algorithms/types";
import { RateLimitStore } from "./types";

interface Entry {
  state: AlgorithmState;
  expiresAt: number;
}

/**
 * In-process store. Perfect for a single instance and local development.
 * State is lost on restart and is NOT shared across instances — use RedisStore
 * if you scale horizontally.
 */
export class MemoryStore implements RateLimitStore {
  private data = new Map<string, Entry>();
  // Tail of the in-flight operation chain per key, used to serialize access.
  private locks = new Map<string, Promise<void>>();

  async get(key: string): Promise<AlgorithmState | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return null;
    }
    return entry.state;
  }

  async set(key: string, state: AlgorithmState, ttlMs: number): Promise<void> {
    this.data.set(key, { state, expiresAt: Date.now() + ttlMs });
  }

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    // Chain onto the previous op regardless of how it settled.
    const result = prev.then(fn, fn);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    this.locks.set(key, tail);
    // Drop the lock entry once we're the last one in the chain.
    tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    });
    return result;
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.data.clear();
    this.locks.clear();
  }
}
