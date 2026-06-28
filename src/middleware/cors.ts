import { NextFunction, Request, Response } from "express";

/**
 * Permissive CORS so a browser-based demo (e.g. GitHub Pages) can call this
 * service directly. This is intentionally open (`*`) because the service is a
 * stateless rate-limit checker with a throwaway demo key — there is nothing
 * sensitive to protect with an origin allow-list. Tighten `Allow-Origin` if you
 * ever put real secrets behind it.
 */
export function cors(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type, x-api-key, x-client-id"
  );
  // Let the browser read the rate-limit headers from JS (hidden by default).
  res.setHeader(
    "Access-Control-Expose-Headers",
    "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After"
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}
