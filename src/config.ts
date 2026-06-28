import fs from "fs";
import path from "path";
import { AlgorithmConfig } from "./algorithms/types";

/** Process-level configuration, sourced from env vars. */
export const config = {
  port: Number(process.env.PORT || 3000),
  apiKey: process.env.API_KEY || "",
  redisUrl: process.env.REDIS_URL || "",
  policiesFile:
    process.env.POLICIES_FILE ||
    path.join(__dirname, "..", "config", "policies.json"),
};

/**
 * A policies file maps client ids to their limit configuration, with a
 * `default` applied to any client without an explicit entry. Editing this file
 * (or pointing POLICIES_FILE elsewhere) is how you tune limits per client
 * without code changes.
 */
export interface PoliciesFile {
  default: AlgorithmConfig;
  clients: Record<string, AlgorithmConfig>;
}

const FALLBACK: PoliciesFile = {
  default: { algorithm: "token_bucket", capacity: 60, refillRatePerSec: 1 },
  clients: {},
};

let cached: PoliciesFile | null = null;

export function loadPolicies(): PoliciesFile {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(config.policiesFile, "utf-8");
    const parsed = JSON.parse(raw) as PoliciesFile;
    cached = {
      default: parsed.default ?? FALLBACK.default,
      clients: parsed.clients ?? {},
    };
  } catch (err) {
    console.warn(
      `Could not read policies file at ${config.policiesFile}; using fallback defaults. (${(err as Error).message})`
    );
    cached = FALLBACK;
  }
  return cached;
}

/** Resolve the effective policy for a client, falling back to `default`. */
export function getPolicyForClient(clientId: string): AlgorithmConfig {
  const policies = loadPolicies();
  return policies.clients[clientId] ?? policies.default;
}
