# ROX AI — API Reference

This is the map of every HTTP endpoint the backend exposes today, plus
every endpoint reserved for a planned feature. It's generated from
reading `backend/server.js`, `backend/src/api/v1/futureRoutes.js`, and
`backend/gatekeeper.js` — if behavior ever drifts from this doc, the
code is the source of truth; open an issue against this file.

This is the **internal** API used by the ROX AI clients (mobile web app).
It is not currently sold or documented as a public developer API — see
§5 for what "public" will mean once `public_api_access` ships.

## 1. Versioning

- Every endpoint is reachable under `/api/v1/...`.
- Endpoints that already existed before versioning (`/api/chat`,
  `/api/generate-image`, `/api/generate-video`, `/api/job-status/:id`,
  `/api/usage-status`) are aliased: a request to `/api/v1/chat` is
  rewritten internally to `/api/chat` and hits the exact same handler.
  There is no behavior difference between the two paths for these
  routes today.
- Endpoints for features not yet built (agents, teams, plugins, API
  keys, referrals — see §4) exist **only** under `/api/v1/...` and are
  not aliased anywhere.
- When a genuine `v2` needs to change behavior (not just exist at a new
  path), it gets mounted at `/api/v2` with its own router — the v1
  alias is a migration convenience, not the general versioning
  mechanism.

## 2. Authentication

All endpoints below (except `/metrics` and `/internal/*`) require a
**Supabase session access token**, sent as:

```
Authorization: Bearer <supabase_access_token>
```

The server verifies the token against Supabase on every request and
derives `userId` from it — a client can never supply its own
`userId` and have it trusted. There is currently no separate API-key
auth mechanism; that's the `public_api_access` extension point (§5).

`/internal/maintenance/run` and `/internal/margin-summary` use a
different scheme entirely: a shared secret in an `x-cron-secret`
header, meant for a scheduler, not a user session.

## 3. Response envelope

Every response body includes a `status` field:

```jsonc
{ "status": "success", /* ...endpoint-specific fields... */ }
{ "status": "error", "message": "human-readable text", "code": "machine_readable_code" }
{ "status": "queued", "jobId": "...", "newBalance": 498 }   // async jobs only
```

`code` (when present) is the value routes and clients should branch
on — `message` may be localized (French or Arabic, depending on the
route) and is not stable across locales. Not every error path has a
`code` yet; treat its absence as "generic error, use `message`."

HTTP status codes in use: `200` success, `202` job accepted/queued,
`401` auth failure, `402` payment/subscription required, `403`
forbidden (wrong owner, blocked IP), `404` not found / feature not
enabled, `429` rate limited, `500` internal error, `501` feature
stubbed but not implemented, `502` all AI models failed, `503` queue
unavailable.

## 4. Live endpoints

### `POST /api/v1/chat`
Chat and code-assistant completions, routed through the AI provider
fallback chain (`aiRouter.js`).

- Auth: required. Also rate-limited per user and gated by
  `gatekeeperMiddleware` (credit balance).
- Body: `{ "messages": [{ "role": "user"|"assistant", "content": "..." }], "feature": "chat" | "code" }`
- Tier behavior:
  - Free tier, `feature: "chat"`: served only by free-tier models
    (no premium model in the chain), capped by a daily message limit,
    costs 0 credits.
  - Free tier, `feature: "code"`: rejected with `402 code_requires_pro`.
  - Pro tier: full fallback chain (premium model first), charged from
    the monthly credit pool.
- Response: `{ status, text, model, dailyChatUsed?, dailyChatLimit?, newBalance? }`
- Errors: `402 pro_out_of_credits`, `402 code_requires_pro`,
  `429 daily_chat_limit`, `502` (all models in the chain failed).

### `POST /api/v1/generate-image`
### `POST /api/v1/generate-video`
Async generation jobs. Both are **Pro-only regardless of credit
balance** (`requireProSubscription`), rate-limited per user, and charge
credits at enqueue time (before the job runs), so a burst of requests
can't queue work for free.

- Body: `{ "prompt": "..." }`
- Response: `202 { status: "queued", jobId, newBalance }`
- If the job can't be created or enqueued, the charge is automatically
  refunded and an error is returned instead of a silently stuck job.
- Errors: `402` (not Pro, or insufficient credits), `503` (queue
  unavailable).

### `GET /api/v1/job-status/:jobId`
Poll (or subscribe via Supabase Realtime to the same row) for a
generation job's status.

- Response: `{ status, result_url, error_message, feature, created_at, completed_at }`
  — note this endpoint's own `status` field is the **job's** lifecycle
  state (`queued`/`processing`/`completed`/`failed`), not the envelope's
  `success`/`error` — this is the one endpoint that overloads the field.
- Errors: `403` if the job belongs to a different user, `404` if not found.

### `GET /api/v1/usage-status`
Current credit/quota snapshot for the calling user — safe to call even
when out of credits (doesn't go through `gatekeeperMiddleware`).

- Response (Pro): `{ status, isPro: true, creditsUsed, creditsTotal, creditsRemaining }`
- Response (Free): `{ status, isPro: false, dailyChatUsed, dailyChatLimit }`

### `GET /metrics`
Prometheus-format telemetry (queue depth, model latency/outcomes,
cost/margin). No `Authorization` header — CORS-open by design for a
dashboard on another origin. If `METRICS_TOKEN` is set in the
environment, requires `x-metrics-token` header or `?token=` query
param, since this payload includes real cost/margin numbers.

## 5. Reserved endpoints (feature-flagged, not yet built)

These exist today at a stable URL so a client can integrate against the
shape now, but respond `404 feature_not_enabled` until their flag in
`backend/config/feature-flags.json` is turned on, and in most cases
`501 not_implemented` even once reachable (the route exists before the
module behind it does). None of these consume credits or affect
billing yet.

| Endpoint | Method | Flag | Notes |
|---|---|---|---|
| `/api/v1/agents` | GET | `ai_agents` | List available AI agents |
| `/api/v1/agents/:id/run` | POST | `ai_agents` | Run an agent |
| `/api/v1/organizations` | GET, POST | `organizations` | List / create orgs |
| `/api/v1/organizations/:orgId/workspaces` | GET | `workspaces` | List workspaces |
| `/api/v1/plugins` | GET | `plugins` | List installed plugins |
| `/api/v1/plugins/install` | POST | `plugins` | Install a plugin from a manifest |
| `/api/v1/api-keys` | GET | `public_api_access` | Self-serve API key management — see §6 |
| `/api/v1/referral-code` | GET | `referral_system` | Get the caller's referral code |
| `/api/v1/referral-code/redeem` | POST | `referral_system` | Redeem a code |

Adding a new reserved endpoint: add the flag to `feature-flags.json`,
add one line to `src/api/v1/futureRoutes.js` (`requireAuth` →
`flagGate(key)` → the module's handler), and document it in the table
above. The route line itself doesn't change again when the feature is
actually implemented — only the handler function does.

## 6. Admin: Business Advisor & Auto Optimizer

Everything under `/api/v1/admin/...` requires the normal Supabase
bearer token (§2) **plus** the calling account having `profiles.is_admin
= true` — a 403 `admin_required` otherwise. Gated additionally by the
`business_advisor` / `auto_optimizer` flags (both live). Every response
uses the standard envelope (§3): `{ status: "success", data: {...} }`.

### Business Advisor

| Endpoint | Method | Notes |
|---|---|---|
| `/api/v1/admin/advisor/report/latest` | GET | Most recent daily report: metrics, insights, health scores, risks, forecast |
| `/api/v1/admin/advisor/report/run` | POST | Run the full pipeline now (same function the daily cron calls) |
| `/api/v1/admin/advisor/recommendations` | GET | `?status=open\|applied\|dismissed\|expired` (default `open`) |
| `/api/v1/admin/advisor/recommendations/:id/resolve` | POST | Body `{ status: "applied"\|"dismissed" }` |
| `/api/v1/admin/advisor/recommendations/:id/outcome` | POST | Body `{ outcome: "improved"\|"neutral"\|"worsened", metricDelta? }` — feeds the confidence-learning loop |

Scheduled run: `POST /internal/advisor/run-daily` (shared `x-cron-secret`
header, same posture as `/internal/maintenance/run` — no user token).
Point any external scheduler at it once a day.

### Auto Optimizer

| Endpoint | Method | Notes |
|---|---|---|
| `/api/v1/admin/optimizer/settings` | GET | Current mode + safety rules |
| `/api/v1/admin/optimizer/mode` | POST | Body `{ mode: "manual"\|"automatic" }` |
| `/api/v1/admin/optimizer/safety-rules` | POST | Body: partial safety-rule overrides, merged over defaults |
| `/api/v1/admin/optimizer/actions` | GET | Audit log of every applied action, `?limit=` |
| `/api/v1/admin/optimizer/actions/apply` | POST | Manually apply one action now — same safety check as automatic mode |
| `/api/v1/admin/optimizer/actions/:id/revert` | POST | Restores the pre-action state from the log row |
| `/api/v1/admin/optimizer/sweep/run` | POST | Manually trigger the automatic-mode sweep once, see what it applies/skips |

Error codes specific to this surface: `409 requires_manual_approval`,
`409 safety_rule_violation`, `429 daily_action_limit_reached`, `429
cooldown_active`, `409 already_reversed`.

See `ARCHITECTURE.md` §11 for how the pipeline and safety model work.

## 7. Admin: Disk Space Monitor & Auto Optimizer (maintenance)

Same auth posture as §6 (`requireAuth` -> `requireAdmin` -> `disk_monitor`
flag gate). Full behavior in `ARCHITECTURE.md` §14.

| Endpoint | Method | Notes |
|---|---|---|
| `/api/v1/admin/disk/report` | GET | Full scan: totals, categories, largest dirs/files, growth flags, recommendations |
| `/api/v1/admin/disk/latest` | GET | Most recent persisted snapshot (no new scan) |
| `/api/v1/admin/disk/settings` | GET | Thresholds, retention days, auto-fix mode |
| `/api/v1/admin/disk/settings` | PUT | Partial update — any subset of the settings fields |
| `/api/v1/admin/disk/actions/:actionType/run` | POST | Run one non-destructive-to-user-data action now (`delete_temp`, `delete_cache`, `delete_old_logs`, `compress_logs`, `delete_old_backups`, `keep_latest_backups`, `docker_prune_images`) |
| `/api/v1/admin/disk/actions/log` | GET | Full maintenance history, `?limit=` |
| `/api/v1/admin/disk/confirmations/request` | POST | Body `{actionType, target, estimatedBytes?, reason?}` — required before removing an Ollama model, pruning Docker volumes, or touching any user-data category |
| `/api/v1/admin/disk/confirmations/pending` | GET | Everything awaiting a decision |
| `/api/v1/admin/disk/confirmations/:id/resolve` | POST | Body `{decision: "confirmed"\|"rejected"}` — the ONLY path that actually executes a confirmation-gated action |

Scheduled scan: `POST /internal/disk/run-scan` (shared `x-cron-secret`,
same posture as `/internal/advisor/run-daily`). Runs a scan + snapshot
always; runs the safe maintenance sweep only if
`disk_monitor_settings.auto_fix_enabled` is true. Never runs anything
in `maintenance.js`'s `NEVER_AUTO` set, regardless of that setting.

Error codes specific to this surface: `400 unknown_action`, `409
requires_manual_approval` (attempting a NEVER_AUTO action with
`triggeredBy: 'auto'`), `400 invalid_decision`, `409 already_resolved`.

## 8. What "public API" will mean (not built yet)

`public_api_access` and `public_sdk` are prepared but intentionally
not implemented — see `backend/src/modules/sdk/index.js`. When built:

- A second auth mechanism (`x-api-key` header, hashed at rest in table
  `api_keys`) alongside the existing Supabase session token, resolved
  by a `requireApiKey` middleware that sets `req.userId` the same way
  `requireAuth` does — every downstream check (rate limiting,
  gatekeeper, credit ledger) keeps working unchanged regardless of
  which auth path was used.
- API-key-authenticated requests will be scoped to `feature:
  "public_api_access"` in `config/plans.json` and gated to the Pro tier
  — free-tier accounts will not be able to mint a key.
- A generated SDK is a thin HTTP client wrapping these same `/api/v1`
  routes — not a separate API surface.

## 9. Webhooks (not built yet)

`backend/src/modules/webhooks/index.js` is a `dispatch(eventName,
payload, ownerId)` stub. When implemented, it delivers to
user-registered URLs (table `webhooks`: `url`, `secret`,
`subscribed_events[]`) for events the system already generates
(generation job completed, credit top-up, plan change), retried via
the existing BullMQ queue rather than a second queue system.
