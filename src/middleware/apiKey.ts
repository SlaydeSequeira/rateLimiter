import { NextFunction, Request, Response } from "express";
import { config } from "../config";

/**
 * Optional shared-secret auth. When API_KEY is unset the service is open
 * (handy for local/demo); when set, callers must send a matching `x-api-key`.
 */
export function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!config.apiKey) {
    next();
    return;
  }
  const provided = req.header("x-api-key");
  if (provided && provided === config.apiKey) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized", message: "Missing or invalid x-api-key header" });
}
