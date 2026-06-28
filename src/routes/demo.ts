import { Request, Response, Router } from "express";
import { RateLimiter } from "../core/rateLimiter";
import { rateLimitMiddleware } from "../middleware/rateLimit";

/**
 * A sample protected endpoint demonstrating how a real service would guard its
 * routes. The rate-limit middleware runs first: it reads the client id, applies
 * that client's policy, and either rejects with 429 or lets the handler run.
 *
 *   curl -H "x-client-id: demo-client" https://<host>/demo/ping
 */
export function demoRouter(limiter: RateLimiter): Router {
  const router = Router();

  router.all("/ping", rateLimitMiddleware(limiter), (req: Request, res: Response) => {
    res.json({
      ok: true,
      message: "Request allowed — you are under your rate limit.",
      clientId: req.header("x-client-id") || req.body?.clientId,
      at: new Date().toISOString(),
    });
  });

  return router;
}
