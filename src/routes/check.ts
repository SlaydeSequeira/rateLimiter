import { Request, Response, Router } from "express";
import { listAlgorithms } from "../algorithms/registry";
import { AlgorithmConfig } from "../algorithms/types";
import { getPolicyForClient } from "../config";
import { RateLimiter } from "../core/rateLimiter";
import { apiKeyAuth } from "../middleware/apiKey";

/**
 * The service API other repos call.
 *
 *   POST /v1/check
 *   { "clientId": "acme", "cost": 1, "policy": { ...optional override... } }
 *
 * Returns the limit decision as JSON (and as standard rate-limit headers).
 * Callers decide what to do with `allowed` — this endpoint never blocks them.
 */
export function checkRouter(limiter: RateLimiter): Router {
  const router = Router();

  router.post("/check", apiKeyAuth, async (req: Request, res: Response) => {
    const clientId: unknown = req.body?.clientId;
    if (typeof clientId !== "string" || !clientId.trim()) {
      res.status(400).json({
        error: "missing_client_id",
        message: "Body must include a non-empty `clientId` string.",
      });
      return;
    }

    const cost = Number(req.body?.cost ?? 1);
    if (!Number.isFinite(cost) || cost <= 0) {
      res.status(400).json({
        error: "invalid_cost",
        message: "`cost` must be a positive number.",
      });
      return;
    }

    // Callers may pass an inline policy to override the configured one.
    const policy: AlgorithmConfig =
      req.body?.policy && typeof req.body.policy === "object"
        ? (req.body.policy as AlgorithmConfig)
        : getPolicyForClient(clientId);

    try {
      const decision = await limiter.check(clientId, policy, cost);
      res.setHeader("X-RateLimit-Limit", decision.limit);
      res.setHeader("X-RateLimit-Remaining", decision.remaining);
      res.setHeader("X-RateLimit-Reset", Math.ceil(decision.resetMs / 1000));
      if (!decision.allowed) {
        res.setHeader("Retry-After", Math.ceil(decision.retryAfterMs / 1000));
      }
      res.status(200).json({ clientId, algorithm: policy.algorithm, ...decision });
    } catch (err) {
      res.status(400).json({ error: "bad_policy", message: (err as Error).message });
    }
  });

  // Discoverability: which algorithms are available to reference in a policy.
  router.get("/algorithms", (_req, res) => {
    res.json({ algorithms: listAlgorithms() });
  });

  return router;
}
