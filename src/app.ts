import express, { NextFunction, Request, Response } from "express";
import { RateLimiter } from "./core/rateLimiter";
import { RateLimitStore } from "./stores/types";
import { checkRouter } from "./routes/check";
import { demoRouter } from "./routes/demo";
import { cors } from "./middleware/cors";

/** Builds the Express app. Kept separate from server bootstrap for testability. */
export function createApp(limiter: RateLimiter, store: RateLimitStore) {
  const app = express();
  app.use(cors);
  app.use(express.json());

  // Liveness/readiness probe for Render's health check.
  app.get("/healthz", async (_req, res) => {
    const storeOk = await store.ping();
    res.status(storeOk ? 200 : 503).json({ status: storeOk ? "ok" : "degraded" });
  });

  app.get("/", (_req, res) => {
    res.json({
      service: "rate-limit-service",
      endpoints: {
        "POST /v1/check": "Ask whether a request for { clientId, cost? } is allowed",
        "GET /v1/algorithms": "List available algorithms",
        "ALL /demo/ping": "Sample endpoint protected by the limiter (send x-client-id)",
        "GET /healthz": "Health check",
      },
    });
  });

  // Service API for other repos.
  app.use("/v1", checkRouter(limiter));
  // Demo of self-protection.
  app.use("/demo", demoRouter(limiter));

  // Central error handler.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal_error", message: err.message });
  });

  return app;
}
