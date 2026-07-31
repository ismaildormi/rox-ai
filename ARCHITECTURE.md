# ROX AI — Architecture

This document is the map: what exists, how it's organized, and — for every
feature on the roadmap that isn't built yet — exactly where it plugs in
later without a rewrite. It assumes the reader is the one developer
maintaining this project.

Nothing in this pass rewrites the hardened v6 backend (`server.js`,
`gatekeeper.js`, `aiRouter.js`, the credit ledger, the queue). Those are
production-tested and stay as-is. This pass adds one new layer around
them — config, feature flags, module boundaries, versioned stub routes,
extensible schema — so the next 40+ features are additions, not surgery.

## 1. Guiding rule

Before writing any new code, ask: **will this still work at 100,000
users, on the same low-cost hosting, without a rewrite?** Concretely,
that means:
- No feature is ever hardcoded into `server.js`'s request path — it goes
  through a config value, a feature flag, or a registry.
- No table is designed only for what it needs today — every table below
  has a `metadata jsonb` escape hatch and nullable `org_id`/`workspace_id`
  columns, added now while they're free (empty/small table), not later
  under load.
- Every new subsystem (agents, plugins, tools, notifications) uses the
  **same** registry pattern (`src/core/registry.js`) instead of a bespoke
  mechanism per feature — one thing to learn and maintain, not ten.

## 2. Layers

```
config/                  → JSON, no code. Feature flags, plan costs, model rates.
src/core/                → config loader, feature flags, registry, logger.
src/modules/             → one folder per domain, each independent and reusable.
  ai/ (providers, tools, agents, personas)
  billing/ (growth = referral + affiliate)
  teams/ (orgs, workspaces)
  plugins/  webhooks/  notifications/  sdk/  analytics/
src/api/v1/               → versioned HTTP layer. Thin: validate → call a module → respond.
lib/*.js                  → existing hardened logic (auth, gatekeeper, queue,
                             aiRouter, rate limits) — untouched, still the
                             source of truth for chat/image/video/billing.
backend/*.sql              → schema, numbered in run order. 12_extension_schema.sql
                             is the forward-compat pass described below.
frontend/                  → mobile-first HTML client (see §6).
```

`lib/` and `src/modules/` intentionally coexist: `lib/` is what already
works and is expensive to touch (it's been through 4 hardening passes).
`src/modules/` is where *new* domains grow. Over time, as a `lib/` file
naturally needs a change anyway, it can migrate into `src/modules/` — not
before, and not all at once.

## 3. Feature flags

`config/feature-flags.json` lists every feature — shipped and planned —
with a default on/off. `src/core/featureFlags.js` resolves a flag in this
order: **per-user/org DB override → env var → config file default**. That
gives three speeds of control: instant per-account override (dogfooding,
early-access orgs) without a deploy, ops-level kill switch via env var,
and the reviewable default in git.

Every planned feature in the request below already has a key in that
file, set to `false`. Turning one on is the actual "launch" step.

## 4. Extension points — one per planned feature

| Feature | Flag key | Extension point (today) | What "implementing it" means later |
|---|---|---|---|
| Teams | `teams` | `src/modules/teams`, tables `workspaces`/`workspace_members` | Wire membership checks into existing auth middleware |
| Organizations | `organizations` | `src/modules/teams`, table `organizations` | Add org-scoped billing (org owns the credit pool) |
| Workspaces | `workspaces` | same module, table `workspaces` | Scope conversations/projects by `workspace_id` (column already exists) |
| AI Agents | `ai_agents` | `src/modules/ai/agents`, table `ai_agents` | Implement `runAgent()`: persona + tool chain + model |
| Plugins | `plugins` | `src/modules/plugins`, table `plugin_installations` | Define a sandboxing/execution model (deliberately not guessed at) |
| Extensions | `extensions` | same module (extensions = client-side plugins) | Add a manifest type for frontend-only extensions |
| Prompt Library | `prompt_library` | table `prompt_library` | CRUD route in `src/api/v1`, no backend logic beyond auth |
| Templates | `templates` | table `templates` | Same — CRUD + a `body jsonb` renderer in the frontend |
| Custom AI Models | `custom_ai_models` | `config/models.json` `_extension_point`, `ai.providers` registry (**live** — see §4a) | Accept a user-supplied `{endpoint, apiKey}` via `registerOpenAiCompatible()`, gate behind the flag |
| Voice AI | `voice_ai` | `config/plans.json` featureCosts.voice_ai, register under `ai.providers` | New provider module + a queue job type (mirrors image/video pattern) |
| Image Generation | — | **live** (`worker.js`, Replicate) | — |
| Video Generation | — | **live** (`worker.js`, Replicate) | — |
| File Analysis | `file_analysis` | `config/plans.json` featureCosts.file_analysis | New route + storage bucket + a tool in `ai.tools` |
| Web Search | `web_search` | `config/plans.json` featureCosts.web_search | Register a `web_search` tool in `src/modules/ai/tools` |
| MCP Servers | `mcp_servers` | `src/modules/ai/tools` (same registry as custom tools) | Add an MCP client that proxies remote tool calls |
| Custom Tools | `custom_tools` | `src/modules/ai/tools` | `registerTool(key, definition)` — mechanism already works |
| Custom AI Personas | `ai_personas` | `src/modules/ai/personas`, table `ai_personas` | `aiRouter.routeRequest()` accepts optional `personaId` |
| API Access | `public_api_access` | `src/modules/sdk`, table `api_keys` | `verifyApiKey()` + a `requireApiKey` middleware alongside `requireAuth` |
| Webhooks | `webhooks` | `src/modules/webhooks`, table `webhooks` | `dispatch()` posts to registered URLs, retried via existing BullMQ |
| Public SDK | `public_sdk` | same as API Access | Thin HTTP client package generated from `src/api/v1` routes |
| Mobile App | `mobile_app` | frontend is already mobile-first HTML (§6) | Wrap in Capacitor/React Native pointed at the same `/api/v1` |
| Desktop App | `desktop_app` | same API | Wrap in Tauri/Electron |
| Browser Extension | `browser_extension` | same API | New thin client, same `/api/v1` contract |
| Notifications | `notifications` | `src/modules/notifications`, table `notifications` | Implement one channel (push) first, others via same registry |
| Admin Dashboard | `admin_dashboard` | `/api/v1/admin/advisor/*`, `/api/v1/admin/optimizer/*` (**live**, §11), plus `/metrics`, `analytics_events`, `system_alerts` | Build the production UI; `tools/admin-dashboard.html` is a working reference client against the same endpoints, not the final UI |
| Analytics Dashboard | `analytics_dashboard` | `src/modules/analytics/events.js`, table `analytics_events` | `track()` already fires; build the read/aggregation side |
| Billing Dashboard | `billing_dashboard` | existing `credit_audit_log`, `rox_margin_last_24h` view | Build the UI; data already tracked |
| Referral System | `referral_system` | `src/modules/billing/growth.js`, table `referral_codes` | Implement redemption crediting via existing `deduct_credit_and_log`-style RPC |
| Affiliate Program | `affiliate_program` | same module, table `affiliate_accounts` | Payout logic, likely an external tool (not custom-built) |
| Marketplace | `marketplace` | `src/modules/plugins` (+ `is_public` on `templates`/`prompt_library`) | Public listing route + review workflow |
| Community Templates | `community_templates` | `templates.is_public` | Public listing route, moderation flag |
| Shared Conversations | `shared_conversations` | table `shared_conversations`, `share_token` | Public read route keyed by token |
| Shared Projects | `shared_projects` | table `projects` + `workspace_members` | Access-control by workspace role |
| Real-time Collaboration | `realtime_collaboration` | Supabase Realtime (already used for job status) | Subscribe to `projects`/`project_versions` the same way |
| Version History | `version_history` | table `project_versions` | Snapshot on save; diff/restore UI |
| Cloud Sync | `cloud_sync` | Supabase is already the source of truth | Mostly a frontend/offline-cache concern (see Offline Support) |
| Offline Support | `offline_support` | — | Frontend-only: local cache + sync queue against existing API |
| Multi-language UI | `multi_language_ui` | `profiles.preferred_locale` | i18n string tables in frontend |
| Dark Mode | `dark_mode` | `profiles.ui_theme` | CSS variables in frontend (see §6) |
| Themes | `themes` | same column, `metadata jsonb` for custom theme data | Extend beyond light/dark |
| Keyboard Shortcuts | `keyboard_shortcuts` | frontend-only | Config-driven keymap object |
| Accessibility | `accessibility_mode` | frontend-only | Audit + ARIA pass, no backend dependency |
| Enterprise SSO / Audit Export / Seats | `enterprise_*` | `organizations`, `analytics_events`, `admin_logs` | SAML/OIDC integration is the only genuinely new piece |

Every row above either points at code that already exists (stub module,
flag, table) or explicitly says what new code is needed — the point is
that nothing requires touching the credit ledger, the auth flow, or the
AI router's fallback logic to add.

## 4a. AI providers are interchangeable now, not just planned

`src/modules/ai/providers/index.js` registers six adapters today —
`anthropic`, `openrouter`, `openai`, `google`, `groq`, `local` — behind
one interface: `call(providerKey, model, messages, opts) -> {text, usage}`.
`aiRouter.js`'s `callModel()` no longer contains any provider-specific
code; it just calls `providers.call(route.provider, route.model, ...)`.
Concretely, this means:

- **Adding a provider** = write an adapter (a `call()` function mapping
  that API's request/response shape to the common one) and
  `registerProvider(key, { call })`. Nothing in `aiRouter.js`, the
  circuit breaker (`lib/modelHealth.js`), or the credit ledger changes.
- **Swapping which provider serves a route** = edit `ROUTES` in
  `aiRouter.js` (`{ provider: 'groq', model: '...' }` instead of
  `'anthropic'`) — a config-shaped one-line change, not a rewrite.
- **A customer's own key/endpoint** (`custom_ai_models` flag) calls
  `registerOpenAiCompatible(key, { baseUrl, apiKey })` at runtime for any
  OpenAI-compatible endpoint (which covers OpenAI, Groq, OpenRouter, most
  local runtimes, and most third-party "OpenAI-compatible" hosts) — no
  new adapter code needed for that common case.
- **Pricing** for a provider not yet in a `ROUTES` chain lives in
  `config/models.json`'s `ratesUnrouted` until it's actually routed, so
  turning one on always means "already has a real number," not
  "silently reports $0 margin impact."
- `openai`, `google`, `groq`, and `local` are registered and callable
  today but **not yet in any `ROUTES` chain** — they exist so wiring one
  in is a `ROUTES` edit, not new provider code, but no traffic reaches
  them until that edit happens.

## 5. API versioning

See `docs/API.md` for the full endpoint reference (auth, response
envelope, every live and reserved route). This section covers the
mechanism; that doc covers the surface.

New endpoints are written directly under `/api/v1/...`
(`src/api/v1/futureRoutes.js`). Existing endpoints (`/api/chat`,
`/api/generate-image`, etc.) keep their original path in `server.js` —
duplicating each into a second router today would mean touching
already-hardened code for no behavior change. Instead, `server.js` now
rewrites `/api/v1/chat` → `/api/chat` etc. before those handlers run, so
**every** endpoint is reachable at `/v1` starting now.

When a real `v2` needs to *change* behavior (not just exist at a new
path), give it its own `express.Router()` mounted at `/api/v2` with its
own handlers — don't extend the rewrite. The rewrite is a v1-only
convenience for the migration period, not the general versioning
mechanism going forward.

## 6. Frontend (mobile-first)

`frontend/rox-ai-mobile_pro.html` is a working, deployed single-file
client. It is **not** being restructured in this pass — a live mobile UI
is not worth destabilizing to satisfy an architecture diagram. The
forward-compatible steps that don't require touching it today:

- `profiles.ui_theme` / `preferred_locale` columns exist now, so Dark
  Mode / Themes / Multi-language can read a real value the day they're
  built, instead of a migration blocking the UI work.
- Any new frontend surface (Mobile App wrapper, Desktop App, Browser
  Extension) targets `/api/v1/*` — one contract, three shells.
- When the HTML file next needs a substantial UI change anyway (a
  natural rewrite trigger, not a scheduled one), split it into
  `frontend/src/{screens,components,api}` at that point, with a
  `config/feature-flags.client.json` mirroring the backend's flags so
  the UI can hide unshipped features instead of hardcoding `if (false)`.

## 7. Configuration strategy

Three JSON files replace what used to be numbers inside `server.js`/`lib/`:

- `config/feature-flags.json` — on/off + tier + status per feature.
- `config/plans.json` — credit costs per feature, per-tier limits, rate
  limits. `server.js` now reads `featureCost('image').credits` instead of
  a literal `1`, etc.
- `config/models.json` — AI provider pricing (`lib/modelCosts.js` reads
  this instead of an inline object).

Env vars still win over config files where they already did (e.g.
`FREE_DAILY_CHAT_LIMIT`, `LOAD_HIGH_RPM`) — this pass didn't remove that,
it added a config layer *underneath* it for the values that were
previously hardcoded with no override at all.

## 8. Database: designed to expand, not to be redesigned

`12_extension_schema.sql` (run after `01`–`11`, same as every prior
migration) adds:
- Nullable `org_id`/`workspace_id` columns to `profiles`,
  `generation_jobs`, `credit_audit_log` — additive, zero risk to existing
  rows or the RLS/trigger logic already protecting them.
- One skeleton table per planned feature, RLS-locked to service-role
  only until that feature's own implementation pass adds real,
  narrower policies (mirroring how `02_rls_policies.sql` did it for
  `profiles`).
- Every new table: `metadata jsonb default '{}'` so an unanticipated
  field never requires a migration, plus `created_at`/`updated_at` for
  the future Admin/Analytics dashboards.

This is the same reasoning as the credit ledger's `metadata jsonb`
column already in `credit_audit_log` (v3.2) — proven useful here once
already.

## 9. Cost and scale notes

- **Registry (`src/core/registry.js`) is in-memory, per-process.** Right
  for now (zero infra, zero latency). If plugins/tools ever need to be
  installed at runtime across multiple server instances without a
  redeploy, swap its internals for a DB-backed lookup — callers
  (`registry.get/list`) don't change.
- **Feature flag DB overrides are opt-in per check** (only queried when
  `userId`/`orgId` is passed) and fail silently to the env/file layer if
  Supabase is slow/unreachable — a flag check must never be able to make
  the API slower or less available than it already is.
- **No new paid infrastructure was added.** Everything above runs on the
  existing Postgres (Supabase) + Redis + the two Railway/Render
  services (API + worker) already in place.

## 11. Business Advisor & Auto Optimizer

Backend is fully built (not a stub, unlike most of §4's extension
points) — `business_advisor` and `auto_optimizer` are both `"status":
"live"` in `config/feature-flags.json`. What exists:

- **Pipeline**: `src/modules/advisor/collect.js` (gather from existing
  tables/views — `rox_daily_business_snapshot`, `rox_margin_last_24h/7d`,
  `system_alerts`, `model_health`, `credit_audit_log`) →
  `health.js`/`risk.js`/`forecast.js` (analyze) → `insights.js` (turn
  numbers into the sentences the spec asked for) → `index.js`
  (orchestrate + persist to `advisor_daily_reports` /
  `advisor_recommendations`, 13_advisor_optimizer_schema.sql).
- **Every score, risk, and forecast is a traceable formula against a
  threshold in `config/advisor.json`** — deliberately not a trained
  model. An admin can see exactly why a number is what it is and retune
  the threshold; that matters more than a fancier-looking black box,
  especially before there's a year of platform history to train on.
- **"Gets smarter over time"** is `advisor_recommendation_outcomes`
  (an admin or a later automated check records whether a resolved
  recommendation actually helped) feeding
  `adjustConfidenceFromHistory()` in `advisor/index.js`, which nudges a
  recommendation category's confidence toward its own track record. Not
  a retrain — a small, auditable Bayesian-flavored blend, capped so
  history can influence but never fully override a rule's stated
  confidence.
- **Auto Optimizer never invents a new change mechanism.** It writes/
  deletes rows in `runtime_overrides`, which `aiRouter.js`/
  `src/core/config.js` already read with the same override-precedence
  pattern as everything else in §3/§4a. Every action — automatic or a
  human clicking "apply" — goes through `assertWithinSafetyRules()`
  first and `optimizer_actions_log` always; being an admin doesn't
  raise the ceiling, it only bypasses the "automatic mode is off" gate.
  Reversal is restoring `before_state` from that same log row.
- Two things the spec asked for and this pass explicitly did **not**
  fabricate: a real MRR ledger (currently a 7-day revenue-trend proxy —
  see `insights.js`'s comment) and step-level funnel/behavioral
  correlation ("users abandon after step 3," "AI Agent users convert
  4x") — both need event data (`analytics_events` with a defined
  step/funnel schema) this platform doesn't collect yet. The advisor
  says so in its own output (`buildOpportunities()`) instead of
  guessing at numbers with no data behind them.
- **Server-cost and storage-growth forecasts are `null`** in
  `forecast.js` for the same reason — no server-cost or storage ledger
  exists yet. Wiring those in means writing to a ledger table (same
  shape as `revenue_events`) from wherever that cost is actually
  incurred (host billing API, storage bucket size check), not
  estimating them from data that doesn't carry that signal.
- **Scheduling**: `POST /internal/advisor/run-daily` (shared
  `x-cron-secret`, same posture as `/internal/maintenance/run`) runs
  collect → analyze → persist, then — only if `optimizer_settings.mode
  = 'automatic'` — runs the optimizer's sweep over what that same run
  produced. Point any scheduler (pg_cron, Railway/Render cron, GitHub
  Actions) at it once a day.
- **Admin surface**: `src/api/v1/adminRoutes.js`, mounted at
  `/api/v1/admin`, `requireAuth` → `requireAdmin` (`lib/requireAdmin.js`,
  reads the new `profiles.is_admin` column — opt-in per account, never
  client-settable) → per-route flag gate. Full reference in
  `docs/API.md`. Same functions are also reachable from the machine
  running the backend without a dashboard or a token, via `rox ai
  advisor`/`rox ai forecast`/`rox ai optimize` (§12) — useful for
  testing the daily cron's output or triggering a sweep by hand.
- **What's still a human decision, on purpose**: `mapRecommendationToAction()`
  in `src/modules/optimizer/index.js` only maps the provider-switch
  category to a concrete auto-appliable override today. Pricing, free-tier
  limits, and abuse actions stay `disallowedWithoutManualApproval` in
  `config/optimizer.json` regardless of mode — the spec's "never make
  financial changes outside admin-defined safety rules" is enforced by
  there being no code path that applies them automatically at all, not
  just a rule that happens to block them.

## 12. Operations: single CLI

Everything in this section is real, not planned — `cli/rox.js`
dispatches to one file per subcommand in `cli/commands/`, documented
fully in `docs/CLI.md`. The short version:

- `rox setup` / `rox update` / `rox start` / `rox stop` / `rox health`
  / `rox backup` / `rox restore` / `rox ai` / `rox queue` / `rox jobs`
  / `rox cron` / `rox server` / `rox latency` are the whole surface.
  No step in any of them requires manually starting `server.js` and
  `worker.js` separately, or manually pasting a new `.sql` file into
  the Supabase SQL Editor (though that's still the fallback if
  `SUPABASE_DB_URL` isn't configured — see `backend/scripts/migrate.js`).
- **Command groups** (`rox ai <sub>`, `rox update <sub>`) are built on
  `cli/lib/group.js` — one small dispatcher, not one bespoke
  multi-word-parsing hack per group. A command handler in
  `cli/rox.js`'s `commands` map is either a plain `(args) => {}`
  function (the original 12 commands) or a group made with
  `makeGroup()` — `rox.js`'s own dispatch never needs to know which,
  since a group is still just a function shaped the same way. This is
  what every future multi-word command (`plugin install`, `user
  create`, etc.) should be built on rather than reinventing dispatch.
- `rox ai status/providers/models/routing/health/advisor/forecast/
  optimize` are CLI views onto backend modules that already exist and
  are already called by the admin API routes
  (`src/modules/ai/providers`, `aiRouter.js`, `lib/modelHealth.js`,
  `src/modules/advisor`, `src/modules/optimizer`) — see `docs/CLI.md`
  for the full reference. Nothing under `cli/commands/ai/` reimplements
  logic or keeps its own copy of provider/model/route/report data.
- **Auto-recovery from a crash** is `ecosystem.config.js`
  (`autorestart`, capped + backed-off restarts) — a pm2 concern, not
  custom supervisor code. `rox health --fix` covers the other common
  failure mode (local Redis not running) that a process supervisor
  can't fix on its own, since restarting `rox-api` doesn't start Redis.
- **Backup backs up Postgres, not Redis** — Redis here only holds
  BullMQ queue state and rate-limit/circuit-breaker counters, all
  regenerable; the credit ledger, users, and advisor data all live in
  Postgres. Backing up the wrong one is the classic mistake this is
  built to avoid.
- `GET /healthz` (added to `server.js`) is what both `rox health` and
  any external uptime monitor hit — unauthenticated by design (an
  orchestrator needs to reach it without a user token) and reports
  connectivity only, no cost/margin numbers (that's still `/metrics`,
  behind `METRICS_TOKEN`).

## 13. Deployment: two independent paths (pm2 CLI, or Docker)

`§12`'s pm2/CLI flow (`./cli/rox.js start`/`stop`/`health`, backed by
`backend/ecosystem.config.js`) is still the primary, bare-metal
deployment path and is completely unchanged by any of this — nothing
below replaces it. Docker is a second, independent way to run the same
two processes (`server.js`, `worker.js`), for a from-scratch local dev
setup or a container-based deployment target that doesn't want pm2 in
the picture at all.

- **`backend/Dockerfile`** / **`backend/Dockerfile.worker`** — one
  multi-stage image each (a `deps` stage for `npm install --omit=dev`,
  a slim `node:20-alpine` runtime stage on top), running `node
  server.js` / `node worker.js` **directly, not through pm2**. Running
  pm2 inside a container on top of the container runtime's own restart
  policy is a well-known anti-pattern (double supervision, and pm2
  doesn't forward `SIGTERM` to its child the way a container runtime
  expects) — `restart: unless-stopped` in `docker-compose.yml` (or
  whatever the orchestrator's own equivalent is) does that job instead.
  Both images run as the non-root `node` user, use `tini` as PID 1 for
  correct signal handling, and have a `HEALTHCHECK` — an HTTP hit on
  `/healthz` for the backend (see §12's note on the same route), a
  Redis reachability check for the worker (it has no HTTP endpoint;
  see the Dockerfile's own comment on what this does and doesn't prove).
- **`docker-compose.yml`** (repo root) — `backend` + `worker` + a local
  `redis:7-alpine`, wired together for local development. Supabase,
  Stripe, Anthropic/OpenRouter, and Replicate stay external managed
  services reached over the network with the credentials in
  `backend/.env` (`env_file:`), same as the bare-metal path — there's
  no local stand-in for any of them. `REDIS_URL` is the one variable
  overridden per-service in compose (`redis://redis:6379`, Docker's
  internal service-name DNS) regardless of what `backend/.env` has it
  set to; every other variable passes through untouched.
- **`backend/.dockerignore`** — keeps `node_modules` (installed fresh
  inside the image), test files, and — most importantly — any real
  `.env` out of the build context entirely. Real secrets only ever
  reach a container via `env_file`/`-e` at `docker run`/compose time,
  never baked into an image layer.
- **What this does NOT do**: no CD pipeline (CI — build/test
  verification — is covered in §13a below; CD — actually deploying
  somewhere — is not built yet), no automated backup strategy for a
  containerized deployment (`rox backup`/`restore` still assume the
  bare-metal/pm2 path's filesystem layout — see §12), and no
  production orchestration beyond `docker-compose.yml`'s local dev
  setup (no Kubernetes manifests, no multi-node scaling story). These
  remain explicitly out of scope until their own pass.

## 13a. Continuous Integration (CI pipeline)

`.github/workflows/ci.yml`, triggered on every push and pull request
to `main` (plus manual `workflow_dispatch`). Four independent jobs,
all required to pass before a PR can merge:

- **`lint`** — `node --check` over every `.js` file in `cli/` and
  `backend/` (syntax only, no linter/style tool is installed in this
  repo, so this is what "lint" means here), `JSON.parse` over both
  `package.json` files, and `docker compose config` to confirm
  `docker-compose.yml` is structurally valid (a synthetic
  `backend/.env` copied from `.env.example` is created for this one
  check, since `env_file:` requires the file to exist — no real
  secrets involved, and the file is removed again immediately after;
  never committed).
- **`test-cli`** — `npm install` (root) then `npm run test:cli`, the
  same 5-file, 38-test suite from §12/the Phase 1 checkpoint.
- **`test-backend`** — `npm install` (`backend/`) then `npm run
  test:unit` (`test-gatekeeper-unit.js`, mocked Supabase — no live
  database, no network dependency beyond npm's own registry).
- **`docker-build`** — builds both `backend/Dockerfile` and
  `backend/Dockerfile.worker` directly (tagged `:ci`, never pushed
  anywhere — no registry credentials exist in this workflow, on
  purpose), then `docker compose config` + `docker compose build` as a
  second check that the compose file and both images agree with each
  other.

Deliberately not run in CI: `backend/test-hardening.js` — a live-HTTP
smoke test that needs a running `server.js`, a real Redis, and a real
Supabase session token (documented at the top of that file). It was
never part of `test:unit`/`test:gatekeeper` (see `backend/package.json`)
and stays a manual/staging-environment check, not something a
credential-less CI runner can do.

**What this does NOT do**: no publish/registry step — verifying an
image builds (§13a's `docker-build` job) is not the same as
distributing it. That's §13b below.

## 13b. Continuous Delivery (CD pipeline)

`.github/workflows/cd.yml`. Publishes versioned Docker images to
GitHub Container Registry (GHCR) — nothing more. It does **not**
deploy anywhere: no SSH, no hosting-provider API call, no server
restart. That distinction matters because this repo has no committed
hosting decision yet (§13's Railway/Render mentions are both still
open) — GHCR needs no new secrets/accounts (authenticates with the
`GITHUB_TOKEN` every workflow already has) and is useful regardless of
which platform "Staging deployment"/"Production deployment" (later,
separate modules) end up targeting: whichever platform is chosen just
pulls `ghcr.io/<owner>/<repo>/backend:<tag>` directly.

- **Gating**: triggers via `workflow_run` on the CI workflow
  (`.github/workflows/ci.yml`) finishing on `main` — and only proceeds
  if that run's `conclusion` was `success`. A CI failure on `main`
  cannot reach a publish. Also triggers on a `v*.*.*` tag push (an
  explicit release cut) and `workflow_dispatch` (manual re-publish of
  the current `main` tip).
- **Tags produced**: every publish gets `sha-<8 hex>` (immutable,
  traceable to the exact commit) and `latest` (always the `main` tip —
  a tag-triggered build never overwrites `latest` with an old release).
  A `v*.*.*` tag push additionally publishes that exact version string
  as a third tag.
- **Images**: `ghcr.io/<owner>/<repo>/backend` and
  `ghcr.io/<owner>/<repo>/worker`, built from the same
  `backend/Dockerfile` / `backend/Dockerfile.worker` §13 already
  documents — no new Dockerfile, no build-instruction changes.
  Registry-backed buildx cache (a `:buildcache` tag per image) speeds
  up repeat builds without a separate cache service.
- **What this does NOT do**: no deploy step of any kind — publishing
  an image to a registry is not the same as running it anywhere. That
  is now §13c below for staging, and §13d for production.

## 13c. Staging Deployment

`.github/workflows/deploy-staging.yml` +
`docker-compose.staging.yml` + `scripts/deploy/staging-deploy.sh`.
Takes a GHCR image §13b already published and actually runs it — the
one thing §13b explicitly stops short of. Full operator runbook
(secrets, host setup, troubleshooting) is `docs/DEPLOYMENT.md`; this
section is the architectural rationale for readers of this file.

- **Why SSH, not a PaaS**: this repo still has no committed
  hosting-platform decision (§13's Railway/Render mentions remain
  open) — the same reason §13b chose GHCR over deploying directly.
  Rather than block staging on that decision, or guess a platform and
  risk writing config against infrastructure that doesn't match what's
  eventually provisioned, staging targets **any host with Docker on
  it** over plain SSH. Whatever platform production eventually picks
  can pull the exact same images this deploys.
- **Trigger**: `workflow_run` on `cd.yml` completing with
  `conclusion == 'success'` (deploys the exact `sha-<8 hex>` tag CD
  just published — not a re-resolved `latest` that could have moved
  again by the time this workflow starts), or `workflow_dispatch` for
  a manual deploy of a specific tag (default `latest`) or a rollback.
- **`docker-compose.staging.yml`**: the staging counterpart of
  `docker-compose.yml` (§13) — same three services, same env var
  handling — with one difference: `image:` (pulled from GHCR) instead
  of `build:` (a local Dockerfile). Staging always runs what CD
  already built, never a fresh build on the staging host.
- **`scripts/deploy/staging-deploy.sh`**: runs on the staging host
  itself (copied there by the workflow via `scp` on every run, so
  nothing needs to be `git clone`d on the host). Logs into GHCR with
  the workflow's own job-scoped `GITHUB_TOKEN` (never stored on the
  host), pulls both images, `docker compose up -d`, then polls the
  same `/healthz` endpoint §12/§13 already document (no new app code)
  until it reports healthy or a retry budget is exhausted.
- **Secrets management**: only SSH access (`STAGING_HOST`,
  `STAGING_SSH_USER`, `STAGING_SSH_KEY`, `STAGING_SSH_PORT`,
  `STAGING_DEPLOY_DIR`) lives in GitHub — as environment-scoped
  secrets under a `staging` GitHub Environment, not repo-level, so a
  future required-reviewers rule can gate this environment
  specifically without touching anything else. App-level secrets
  (Supabase, Stripe, etc.) are **not** passed through Actions at all —
  they live in a `.env` file created once, by hand, directly on the
  staging host, reusing the exact `env_file` convention
  `backend/.env` already has (§13). Secrets never transit CI logs.
- **Rollback**: automatic and manual, both are just "deploy an older
  tag" through the same pull → health-check path, not a separate code
  path with its own risk profile. The script tracks one level of
  history (`.current-tag` / `.previous-tag` in the deploy directory);
  if the newly deployed tag fails its health check, the script
  immediately redeploys the last known-good tag itself — the GitHub
  Actions run still reports failure (the requested tag didn't
  actually deploy), even when staging itself recovered automatically.
  A manual rollback (`workflow_dispatch` with `rollback: true`)
  redeploys whatever `.previous-tag` currently holds. Going back
  further than one step means deploying that exact historical
  `sha-<8 hex>` tag explicitly — every build CD ever published stays
  in GHCR.
- **Verification**: the health-check loop above is what gates whether
  a deploy is considered successful at all — an unhealthy deploy never
  silently "succeeds." For deeper manual verification of a running
  staging instance, `backend/test-hardening.js` (§13a's "deliberately
  not run in CI" smoke test) can be pointed at the staging host
  directly — see `docs/DEPLOYMENT.md`'s verification section for the
  command and the caveat about which IP to run it from.
- **Validation before touching the host**: a `validate` job runs
  first, structurally checking `docker-compose.staging.yml` (same
  `docker compose config` approach §13a's `lint` job already uses) and
  shellchecking the deploy script — config mistakes are caught before
  any SSH connection is attempted.
- **What this does NOT do**: no multi-host/load balancing story (one
  staging host, by design — this is a pre-production verification
  environment, not a scaling target), and no change to `rox
  backup`/`restore` (§12, still bare-metal/pm2-only — unaffected by
  this module, same as §13 already notes for the plain Docker path).
  Production deployment (§13d below) reuses the same GHCR images but
  is not simply "staging pointed at a different host" — see §13d for
  what's different and why.

## 13d. Production Deployment

`.github/workflows/deploy-production.yml` +
`docker-compose.production.yml` +
`scripts/deploy/production-deploy.sh` +
`nginx/active.conf.template`. Reuses the exact GHCR images §13b
publishes and §13c already proved out against staging, but the
deployment *mechanics* are deliberately different from staging in two
ways: the cutover is blue/green instead of in-place, and the trigger
is manual-only instead of automatic. Full operator runbook (secrets,
host setup, troubleshooting) is `docs/DEPLOYMENT.md`'s Production
Deployment section; this section is the architectural rationale.

- **Why blue/green here but not for staging**: staging's in-place
  restart-then-health-check-then-rollback-if-needed model (§13c) is a
  reasonable trade for a pre-production verification environment — a
  few seconds of staging downtime during a bad deploy costs nothing.
  The same trade is not acceptable once real users are involved: a
  deploy should never have a window where no healthy backend is
  serving traffic, and a *failed* deploy should have zero effect on
  what's currently live rather than triggering a same-day rollback of
  something that was already running. Blue/green — `backend-blue` and
  `backend-green` both always running, an nginx reverse proxy deciding
  which one is "active" — gets both properties: cutover is a graceful
  `nginx -s reload` (in-flight requests finish on the old color, new
  requests get the new one), and a failed deploy simply never reaches
  the cutover step at all, leaving the active color completely
  untouched.
- **Why manual-only, unlike staging's `workflow_run` auto-trigger**:
  staging deploying automatically after every successful CD run is the
  point — it's meant to always reflect `main`. Production should never
  move just because CI/CD and a staging deploy happened to pass; it
  moves when a human explicitly names a tag (`workflow_dispatch`'s
  `image_tag` input, no default) *and* the `production` GitHub
  Environment's required-reviewers rule approves the run. Two
  independent gates — an explicit tag and a human approval — is the
  "deployment protection" layer this module adds that staging
  intentionally doesn't have.
- **`docker-compose.production.yml`**: staging's three services
  (`redis`, `backend`, `worker`) plus `backend-blue`/`backend-green`
  replacing the single `backend`, and an `nginx` service in front of
  them. `backend-blue`/`backend-green` each also publish a
  color-specific host port (`3011`/`3012`) purely so
  `production-deploy.sh` can health-check the *inactive* color
  directly, bypassing nginx — real traffic only ever arrives through
  nginx's published port. `worker` is intentionally not blue/green:
  it has no HTTP client waiting on it, and BullMQ job state lives in
  Redis (`backend/lib/queue.js`), not in the worker process itself, so
  a brief in-place restart delays job pickup by seconds without losing
  any job — the same category of trade-off §13/§13c already make
  elsewhere for things that don't need the heavier treatment.
- **`nginx/active.conf.template`**: one placeholder
  (`__ACTIVE_UPSTREAM__`), substituted by `production-deploy.sh` with
  either `backend-blue:3001` or `backend-green:3001` (Docker-internal
  service DNS — nginx and both backend containers share the compose
  network) and written to `nginx/conf.d/active.conf` on the host. The
  rendered file itself is host state, not committed — same category as
  staging's `.current-tag`/`.previous-tag`.
- **`scripts/deploy/production-deploy.sh`**: runs on the production
  host, invoked over SSH the same way `staging-deploy.sh` is. Reads
  which color is active (`.active-color`, defaulting to `blue` on a
  fresh host), pulls the target tag, starts/recreates only the
  *inactive* color, health-checks it on its dedicated port, and only
  on success renders the nginx template and issues `nginx -s reload`.
  The previously-active color is deliberately left running (never
  stopped) — see Rollback below for why.
- **Secrets management**: same shape as staging's five SSH-access
  secrets (`PRODUCTION_HOST`, `PRODUCTION_SSH_USER`,
  `PRODUCTION_SSH_KEY`, `PRODUCTION_SSH_PORT`,
  `PRODUCTION_DEPLOY_DIR`), environment-scoped under a `production`
  GitHub Environment — **with required reviewers configured on that
  environment**, which staging's does not have. App-level secrets
  (Supabase, Stripe live keys, etc.) never transit GitHub Actions at
  all, identical to staging's posture: they live in a `.env` file
  created once, by hand, on the production host.
- **Rollback**: because a failed deploy never reaches the cutover step,
  there is no "automatic rollback of a bad deploy" the way staging
  needs one — nothing bad ever went live to roll back from. Manual
  rollback (`workflow_dispatch` with `rollback: true`) instead flips
  nginx back to whichever color is currently inactive (normally
  whatever was active before the last deploy) — no pull, no restart,
  close to instantaneous, since that color was serving real traffic
  minutes or hours ago and never stopped. Only one step of implicit
  history is available this way; going back further means deploying
  that exact historical `sha-<8 hex>` tag explicitly, same as staging.
- **Verification**: three independent checks per deploy — the
  pre-cutover health check of the inactive color (on-host, direct to
  its dedicated port, bypassing nginx), the `nginx -s reload` exit
  code, and a post-deploy external `curl` to `/healthz` from the
  GitHub Actions runner itself (catches a firewall/DNS/nginx-port
  mismatch an on-host `localhost` check wouldn't).
- **Validation before touching the host**: same `validate` job pattern
  as staging — `docker compose config` on
  `docker-compose.production.yml`, shellcheck on
  `production-deploy.sh`, plus a check that
  `nginx/active.conf.template` still has its placeholder.
- **What this does NOT do**: no multi-region/multi-host story (one
  production host, blue/green on that single host — a further scaling
  pass would need a load balancer in front of multiple hosts, out of
  scope here), no automated database migration step (schema changes
  under `backend/*.sql` are still applied the same way §12/`rox
  setup`/`rox update` already document — unaffected by this module),
  and no TLS termination (this module assumes a TLS-terminating layer
  — a CDN, load balancer, or separate reverse proxy — already sits in
  front of the host; `nginx` here proxies plain HTTP on the internal
  side, same posture `server.js` itself has always had).

## 14. Disk Space Monitor & Maintenance

Backend is fully built (like §11, not a stub) — `disk_monitor` is
`"status": "live"` in `config/feature-flags.json`. What exists:

- **Scanning is honest about what's local and what isn't.**
  `backend/lib/diskScan.js` has zero DB dependency — `df`/`du` for
  totals, a pure-JS bounded directory walker (never shells out to GNU
  `find -printf`, which breaks on macOS/BSD) for largest dirs/files,
  Ollama's own `/api/tags` HTTP endpoint for model sizes (no
  filesystem access to `~/.ollama` needed at all), `docker system df`
  for Docker, and a `rox_database_size_bytes()` SQL function (added in
  `14_disk_monitor_schema.sql`) for Postgres size, since supabase-js
  only speaks PostgREST, not raw SQL.
- **Uploads/generated images/generated videos are reported as
  `{available: false}` by default, not invented.** This deployment's
  `generation_jobs.result_url` already points at Replicate/Supabase
  Storage — there is no local directory to measure unless a future
  feature is explicitly configured to write one (`UPLOADS_DIR`,
  `GENERATED_IMAGES_DIR`, `GENERATED_VIDEOS_DIR` env vars). Reporting a
  fabricated number for a category that doesn't exist on this
  deployment would be worse than reporting "not configured."
- **Health levels are threshold math against `config/diskMonitor.json`
  defaults / `disk_monitor_settings` DB overrides** — 🟢/🟡/🟠/🔴 at
  75/90/95% by default, admin-editable via `PUT
  /api/v1/admin/disk/settings`. Same "config file + DB override, fully
  transparent" pattern as §11's health scores.
- **Abnormal growth detection** is a diff between the newest snapshot
  and the one closest to 24h before it (`disk_usage_snapshots`) — same
  reasoning as §11's forecast: a real trend against real history, not
  a guess.
- **The reversibility honesty from §11/§12 continues here, adjusted for
  reality**: most disk actions (deleting a log file, an old backup)
  genuinely can't be undone. `disk_maintenance_log` doesn't pretend
  otherwise — every row has `reversible: false` and a complete
  `manifest` of exactly what was touched, which is the honest
  substitute for an undo button: full transparency into what happened,
  not a false promise that it can be reversed.
- **The one rule enforced in code, not just at the route layer**:
  `maintenance.js`'s `NEVER_AUTO` set (`remove_ollama_model`,
  `docker_prune_volumes`, and any future user-data category) can never
  run with `triggeredBy: 'auto'` — `runAction()` itself throws
  `requires_manual_approval` regardless of `auto_fix_enabled`. The only
  path that executes one of these is `resolveConfirmation()`, which
  requires a `disk_pending_confirmations` row already moved to
  `'confirmed'` by a specific authenticated admin action — a separate
  request from whatever proposed it. This is what "never delete user
  data automatically, always require confirmation" means in code, not
  just in a safety-rules JSON file. `remove_ollama_model`,
  `docker_prune_volumes`, `delete_uploads`, and `delete_generated_content`
  all have a real executor wired behind that confirmation (age-based
  deletion only for the latter two — `target.olderThanDays` is
  required, there is no guessed default for user content) — none of
  them are placeholder stubs.
- **Fix Automatically mode** (`disk_monitor_settings.auto_fix_enabled`)
  only ever triggers `maintenance.js`'s `runSafeSweep()` — temp, cache,
  old logs, log compression, unused Docker images. Nothing in that list
  can touch a model, an upload, or generated content, by construction
  (they're simply not in `runSafeSweep`'s action list), not because a
  check happens to catch them at request time.
- **Scheduling**: `POST /internal/disk/run-scan` (shared
  `x-cron-secret`, same posture as `/internal/advisor/run-daily`) scans
  and persists a snapshot always, and additionally runs
  `runSafeSweep('auto')` only if `auto_fix_enabled` is true.
- **CLI integration** (`docs/CLI.md`): `rox health` does a *fast*
  disk check (df totals + threshold only, no directory walk — it needs
  to stay cron-safe) and can auto-fix at critical/emergency via the
  same safe sweep. `rox doctor` and `rox monitor` call the *full*
  scan (categories, largest dirs/files, growth flags) directly against
  `src/modules/diskMonitor` — no HTTP round trip, same reasoning as
  `backup.js`/`migrate.js` reaching into the backend directly since
  the CLI runs on the same host. `rox optimize` runs the safe sweep and
  surfaces/manages confirmations.
- **Admin surface**: `src/api/v1/adminRoutes.js`, `/api/v1/admin/disk/*`,
  full reference in `docs/API.md` §7.

## 15. What NOT to do next

- Don't turn on more than one flag at a time in production without
  reading its row in §4 first — some (agents, plugins) explicitly still
  need a design decision (sandboxing, execution model) that this pass
  deliberately left open rather than guessing at.
- Don't rewrite `rox-ai-mobile_pro.html` just to "match" this
  architecture — see §6.
- Don't add a second registry/plugin mechanism for a new feature; extend
  `src/core/registry.js`'s existing bucket pattern instead.
- Don't map a new recommendation category into
  `mapRecommendationToAction()` (optimizer auto-apply) without adding it
  to `config/optimizer.json`'s `allowedActionTypes` first and thinking
  through the reversal path — `disallowedWithoutManualApproval` is the
  safe default for a reason.
- Don't compute MRR, funnel drop-off, or server/storage cost forecasts
  from a proxy metric because it's convenient — add the real ledger/event
  schema first (§11 says what each one needs) or leave the field `null`
  the way `forecast.js` already does.
- Don't add a new service (a second worker, a cron job, anything meant
  to run continuously) without a `pm2` entry in `ecosystem.config.js`
  and a line in `docs/CLI.md` — "start everything with one command"
  breaks the moment something new has to be started by hand.
- Don't add a new disk maintenance action that touches anything a user
  created (uploads, generated content, a paid add-on) to
  `maintenance.js`'s safe-sweep list — route it through
  `disk_pending_confirmations` and add it to `NEVER_AUTO` instead, same
  as `remove_ollama_model`.
