import { NextFunction, Request, Response } from "express";
import { getPolicyForClient } from "../config";
import { RateLimiter } from "../core/rateLimiter";

/** Where to read the client id from on an incoming request. */
function resolveClientId(req: Request): string | null {
  return (
    req.header("x-client-id") ||
    (typeof req.body?.clientId === "string" ? req.body.clientId : null) ||
    (typeof req.query.clientId === "string" ? req.query.clientId : null) ||
    null
  );
}

/**
 * Express middleware that enforces a client's rate limit before the route
 * handler runs. This is how a service protects its own endpoints (see the demo
 * route). Other repos that just want a yes/no answer can call POST /v1/check
 * instead.
 */
export function rateLimitMiddleware(limiter: RateLimiter) {
  return async function (req: Request, res: Response, next: NextFunction) {
    try {
      const clientId = resolveClientId(req);
      if (!clientId) {
        res.status(400).json({
          error: "missing_client_id",
          message: "Provide a client id via `x-client-id` header or `clientId` field.",
        });
        return;
      }

      const policy = getPolicyForClient(clientId);
      const decision = await limiter.check(clientId, policy);

      res.setHeader("X-RateLimit-Limit", decision.limit);
      res.setHeader("X-RateLimit-Remaining", decision.remaining);
      res.setHeader("X-RateLimit-Reset", Math.ceil(decision.resetMs / 1000));

      if (!decision.allowed) {
        res.setHeader("Retry-After", Math.ceil(decision.retryAfterMs / 1000));
        res.status(429).json({
          error: "rate_limited",
          message: `Rate limit exceeded for client "${clientId}".`,
          retryAfterMs: decision.retryAfterMs,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
