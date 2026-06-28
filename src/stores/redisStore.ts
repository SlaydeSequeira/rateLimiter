import { AlgorithmState } from "../algorithms/types";
import { RateLimitStore } from "./types";

/**
 * Redis-backed store for sharing limits across multiple instances.
 *
 * `ioredis` is an optional dependency: it is only required (lazily) when this
 * store is constructed, i.e. only when REDIS_URL is configured. The default
 * deployment never needs it installed.
 */
export class RedisStore implements RateLimitStore {
  // typed as any so the build doesn't require ioredis to be installed.
  private client: any;

  constructor(url: string) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Redis = require("ioredis");
    this.client = new Redis(url, { maxRetriesPerRequest: 2 });
  }

  async get(key: string): Promise<AlgorithmState | null> {
    const raw = await this.client.get(`${key}:state`);
    return raw ? (JSON.parse(raw) as AlgorithmState) : null;
  }

  async set(key: string, state: AlgorithmState, ttlMs: number): Promise<void> {
    await this.client.set(
      `${key}:state`,
      JSON.stringify(state),
      "PX",
      Math.max(1, Math.ceil(ttlMs))
    );
  }

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = `${key}:lock`;
    for (let attempt = 0; attempt < 50; attempt++) {
      const acquired = await this.client.set(lockKey, "1", "NX", "PX", 1000);
      if (acquired) {
        try {
          return await fn();
        } finally {
          await this.client.del(lockKey);
        }
      }
      await delay(20);
    }
    // Couldn't acquire in time; proceed anyway rather than fail the request.
    // Worst case is a slightly looser limit under heavy contention.
    return fn();
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
