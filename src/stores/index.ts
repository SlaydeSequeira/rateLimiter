import { config } from "../config";
import { MemoryStore } from "./memoryStore";
import { RateLimitStore } from "./types";

/**
 * Picks a store based on configuration: Redis when REDIS_URL is set (shared
 * across instances), otherwise an in-memory store (single instance).
 */
export async function createStore(): Promise<RateLimitStore> {
  if (config.redisUrl) {
    const { RedisStore } = await import("./redisStore");
    return new RedisStore(config.redisUrl);
  }
  return new MemoryStore();
}

export { RateLimitStore } from "./types";
