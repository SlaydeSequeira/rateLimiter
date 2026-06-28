import { createApp } from "./app";
import { config } from "./config";
import { RateLimiter } from "./core/rateLimiter";
import { createStore } from "./stores";

async function main() {
  const store = await createStore();
  const limiter = new RateLimiter({ store });
  const app = createApp(limiter, store);

  const server = app.listen(config.port, () => {
    console.log(`rate-limit-service listening on :${config.port}`);
    console.log(`store: ${config.redisUrl ? "redis" : "memory"}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down...`);
    server.close();
    await store.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
