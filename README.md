# rate-limit-service

A small, generic rate-limiting microservice. Other services call it with a
**client id** and it answers whether that client is within its limit. It ships
with four algorithms — **token bucket**, **leaky bucket**, **fixed window** and
**sliding window** — and the algorithm and storage backend are both pluggable,
so you can add more without touching callers.

Deploys to [Render](https://render.com) with a single `git push` (a Blueprint
is included).

---

## How it works

```
caller ──POST /v1/check { clientId }──▶  RateLimiter ──▶ Algorithm (token_bucket)
                                              │
                                              └────────▶ Store (memory | redis)
        ◀── { allowed, remaining, retryAfterMs, ... } ──
```

- **Algorithm** decides allow/deny from the client's saved state. Pure function,
  easy to test and swap. (`src/algorithms/`)
- **Store** persists per-client state. In-memory by default; Redis when you set
  `REDIS_URL` (needed if you run more than one instance). (`src/stores/`)
- **Policies** map each client id to its limits. (`config/policies.json`)

## Endpoints

| Method & path        | Purpose                                                        |
|----------------------|----------------------------------------------------------------|
| `POST /v1/check`     | Ask if a request for `{ clientId, cost? }` is allowed.         |
| `GET  /v1/algorithms`| List registered algorithms.                                    |
| `ALL  /demo/ping`    | Sample endpoint protected by the limiter (send `x-client-id`). |
| `GET  /healthz`      | Health check (used by Render).                                 |

### `POST /v1/check` — the API other repos call

Request:
```json
{
  "clientId": "acme-corp",
  "cost": 1,
  "policy": { "algorithm": "token_bucket", "capacity": 100, "refillRatePerSec": 10 }
}
```
`cost` (default `1`) and `policy` (defaults to the client's configured policy)
are optional.

Response (`200`, always — the caller decides what to do with `allowed`):
```json
{
  "clientId": "acme-corp",
  "algorithm": "token_bucket",
  "allowed": true,
  "limit": 100,
  "remaining": 99,
  "resetMs": 100,
  "retryAfterMs": 0
}
```
Standard `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` and
`Retry-After` headers are set too.

### Calling it from another repo

```js
async function isAllowed(clientId) {
  const res = await fetch("https://<your-service>.onrender.com/v1/check", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.RL_API_KEY },
    body: JSON.stringify({ clientId }),
  });
  const { allowed, retryAfterMs } = await res.json();
  return { allowed, retryAfterMs };
}
```

## Configuring limits

Edit [`config/policies.json`](config/policies.json):
```json
{
  "default":  { "algorithm": "token_bucket", "capacity": 60,   "refillRatePerSec": 1 },
  "clients": {
    "demo-client":    { "algorithm": "token_bucket", "capacity": 5,    "refillRatePerSec": 0.5 },
    "premium-client": { "algorithm": "token_bucket", "capacity": 1000, "refillRatePerSec": 50 }
  }
}
```
Any client without an entry gets `default`. Point `POLICIES_FILE` at another file
to override.

> **Token bucket params:** `capacity` = max burst size; `refillRatePerSec` =
> sustained requests per second once the burst is used up.

## Environment variables

| Var            | Default            | Notes                                                        |
|----------------|--------------------|--------------------------------------------------------------|
| `PORT`         | `3000`             | Render sets this automatically.                              |
| `API_KEY`      | _(empty = open)_   | When set, callers must send `x-api-key`.                     |
| `REDIS_URL`    | _(empty = memory)_ | Set to share limits across multiple instances.              |
| `POLICIES_FILE`| `config/policies.json` | Path to a custom policies file.                         |

See [`.env.example`](.env.example).

## Run locally

```bash
npm install
npm run dev          # hot-reload on http://localhost:3000
# or
npm run build && npm start
npm test             # algorithm unit tests
```

Try it:
```bash
curl -X POST localhost:3000/v1/check -H 'content-type: application/json' \
  -d '{"clientId":"demo-client"}'

curl -H 'x-client-id: demo-client' localhost:3000/demo/ping   # 200 until limit, then 429
```

## Deploy to Render (push to deploy)

1. Push this repo to GitHub.
2. In Render: **New + → Blueprint**, pick this repo. Render reads
   [`render.yaml`](render.yaml) and provisions a Node web service
   (`npm install && npm run build` → `npm start`), generating an `API_KEY`.
3. Done. Subsequent `git push`es auto-deploy.

To share limits across multiple instances, create a Render Key Value (Redis)
instance and wire its connection string into `REDIS_URL` (commented example in
`render.yaml`).

## Adding another algorithm later

The design is built for this. To add, say, a sliding-window limiter:

1. Implement `RateLimitAlgorithm` (copy `src/algorithms/tokenBucket.ts`).
2. Register it in [`src/algorithms/registry.ts`](src/algorithms/registry.ts):
   ```ts
   registerAlgorithm(new SlidingWindowAlgorithm());
   ```
3. Reference it from a policy: `"algorithm": "sliding_window"`.

No changes to the store, HTTP, or calling code. Same pattern applies to new
storage backends — implement `RateLimitStore` in `src/stores/`.

## Project layout

```
config/policies.json     per-client limits
src/algorithms/          algorithm interface + registry + token bucket
src/stores/              store interface + memory + redis + selector
src/core/rateLimiter.ts  ties an algorithm + store together
src/middleware/          api-key auth + rate-limit guard
src/routes/              /v1/check + /demo
src/app.ts, server.ts    express app + bootstrap
render.yaml              Render Blueprint (push to deploy)
```
