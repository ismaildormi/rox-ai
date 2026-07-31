# ROX AI CLI — Roadmap

This is the long-term plan for turning the full requested command list
into real, working commands — incrementally, without a rewrite, and
without ever registering a command ahead of the subsystem it depends
on. See `ARCHITECTURE.md` for how the backend is laid out and which
extension points already exist; this file is about the CLI surface and
build order specifically.

**Rule this roadmap follows:** a command is only added to `cli/rox.js`
once its underlying subsystem is real. If the subsystem doesn't exist
yet, the phase below says what has to be *designed* first — not "add a
stub that prints not-yet-implemented."

## How to read the phase table

- **Status**: `live` (built, in this repo today), `next` (backend
  mostly exists, CLI wiring is the remaining work), `needs design` (no
  code should be written until an open question is answered), `backend
  missing` (real backend work needed before any CLI wiring).
- **Depends on**: subsystem(s) that must exist first.

## Phase 0 — Foundation (done)

| Piece | Status |
|---|---|
| `cli/lib/group.js` — multi-word command dispatch | live |

Every phase below registers its commands as a group (`rox <group>
<sub>`) built on this, not a one-off parser.

## Phase 1 — AI subsystem (done)

| Command | Status | Backend it calls |
|---|---|---|
| `rox ai status` | live | `src/modules/ai/providers`, `src/core/config`, `aiRouter.js` |
| `rox ai providers` | live | `src/modules/ai/providers` |
| `rox ai models` | live | `config/models.json`, `aiRouter.js` ROUTES |
| `rox ai routing` | live | `aiRouter.js` (`ROUTES`, `getEffectiveChain`) |
| `rox ai health` | live | `lib/modelHealth.js` (circuit breaker) |
| `rox ai advisor` | live | `src/modules/advisor` |
| `rox ai forecast` | live | `src/modules/advisor/forecast.js` (via `getLatestReport`) |
| `rox ai optimize` | live | `src/modules/optimizer` |
| `rox update models` | live | same as `ai models` + live upstream model-list verification |
| `rox update providers` | live | same as `ai providers` + live reachability probe |

Not built in this phase, and why:

| Requested command | Status | Note |
|---|---|---|
| `rox ai cache` | next | `lib/modelHealth.js` already caches circuit state in Redis (`circuit:<model>`, 5s TTL). CLI command = read/clear those keys directly via `lib/queue.js`'s `connection`. Small, no design question. |
| `rox ai monitor` | needs design | Would overlap `rox monitor` (disk) and `rox ai status`/`health` combined. Needs a decision on what it adds beyond running both — e.g. a `--watch` live loop like `rox monitor` has — before it's worth a separate command. |
| `rox ai costs` | next | Real margin data exists (`credit_audit_log`, `rox_margin_last_24h` view per ARCHITECTURE.md's Billing Dashboard row) but no module reads it yet outside the advisor's `collect.js` snapshot. CLI wiring = a query function in a new small module, not a new concept. |
| `rox ai statistics` | needs design | Overlaps `costs`/`status`/`advisor` — needs a decision on what's distinct about "statistics" specifically (e.g. request volume/latency percentiles from `lib/metrics.js`'s Prometheus registry) before it's its own command instead of a flag on an existing one. |
| `rox ai repair` | needs design | The only thing to "repair" today is a stuck-open circuit (`rox ai health` already reports this) or a stale Redis cache entry (see `cache` above). Needs a decision on whether "repair" means force-closing a circuit (bypasses the breaker's own logic — a safety question, not just a CLI one) before building it. |

## Phase 7 — Queue, cron, server info, latency (done)

| Command | Status | Backend it calls |
|---|---|---|
| `rox queue status/clear/restart` | live | `backend/lib/queue.js` (BullMQ) |
| `rox jobs` | live | `backend/lib/queue.js` |
| `rox cron status/restart` | live | `src/modules/advisor`, `src/modules/diskMonitor`, `src/modules/optimizer`, `lib/supabaseAdmin.js` (the same functions `/internal/*` calls) |
| `rox server info` | live | `os` (built-in) + pm2 `jlist` |
| `rox latency` | live | `lib/queue.js`, `lib/supabaseAdmin.js`, AI provider base URLs |

Notes on naming honesty in this phase:
- `rox queue restart` pauses+resumes the BullMQ queues — it does
  **not** restart the `rox-worker` process (`rox restart` does that).
  Documented explicitly in the command's own `--help` output and
  `docs/CLI.md`, not left implied.
- `rox cron restart` doesn't restart anything either — there's no
  in-process scheduler to restart (the three `/internal/*` jobs are
  called by an *external* scheduler). It manually triggers all three
  jobs' underlying functions right now instead, and says so.

Not built in this phase, and why:

| Requested command | Status | Note |
|---|---|---|
| `rox scheduler reload` | not applicable | Nothing to reload — the "schedule" (once a day, etc.) lives entirely in whatever external system calls `/internal/*` (cron table, GitHub Actions YAML, Railway cron config), which this repo doesn't own or configure. `rox cron status`/`restart` cover everything this app-side can meaningfully report or trigger. |
| `rox websocket status/logs` | backend missing | Checked: this project has no WebSocket/Socket.IO server anywhere in `backend/` today (confirmed by grep across `server.js`/`worker.js`). Not "next" like the rest of this phase — there's no subsystem to expose yet. Would need a design decision on what would even use a persistent connection (streaming AI responses? live job progress instead of polling?) before it's worth building. |
| `rox cpu` / `rox ram` | next | `rox server info` already reports both as part of its machine overview; a decision needed on whether standalone `rox cpu`/`rox ram` should just be `rox server info` filtered to one section (thin wrapper) or carry more detail (e.g. per-core, process-level breakdown) before splitting them out. |
| `rox gpu` | not applicable | No GPU workload exists in this project (image/video generation goes through Replicate's API, not a local GPU) — would report "n/a" honestly rather than fake data, but that's not worth a command on its own yet. |
| `rox network` | next | `os.networkInterfaces()` is trivial to add; low priority since `rox latency` already covers the "is connectivity actually working" question this would mostly be used for. |
| `rox bandwidth` | needs design | No bandwidth accounting exists at any layer (app or OS tooling like vnstat isn't assumed to be installed). Needs a decision on what "bandwidth" should mean here — per-provider API call volume (derivable from `credit_audit_log`) is answerable; OS-level throughput isn't without adding a new dependency. |
| `rox benchmark` | next | Real building blocks all exist now (`rox latency`'s timers, `rox ai models`'s upstream verification) — "benchmark" mostly needs a decision on what composite score/threshold it reports, not new plumbing. |

## Phase 2 — Disk/ops surface already built, needs `rox` grouping

Real backend exists (`src/modules/diskMonitor`), already exposed as
top-level `rox monitor`/`rox optimize`/`rox doctor`. No new work here
— listed for completeness since some of the original command list
(`rox storage status`, `rox storage optimize`) maps onto this existing
surface rather than needing anything new.

| Requested command | Maps to |
|---|---|
| `rox storage status` | `rox monitor` |
| `rox storage optimize` | `rox optimize` |
| `rox storage repair` | `rox doctor --fix` |
| `rox diagnostics` | `rox doctor` |
| `rox uploads` / `rox media optimize` / `rox image optimize` / `rox video optimize` | needs design — no per-media-type breakdown exists in `diskScan.js` today, only aggregate categories. Real work: extend `diskScan.js`'s categorization, not a new subsystem. |

## Phase 3 — Users, roles, permissions (backend missing)

| Requested commands | Status |
|---|---|
| `rox users`, `rox user create/delete/suspend/activate`, `rox roles`, `rox permissions` | backend missing |

`profiles.is_admin` (added in `13_advisor_optimizer_schema.sql`) is
the only role concept that exists, and it's binary and manually set —
see ARCHITECTURE.md's note that this is deliberate ("not every user
should be able to self-promote from a UI"). A real roles/permissions
system needs:
1. A schema decision: role as an enum column vs. a `roles` +
   `user_roles` join table (the latter if permissions need to be
   composable, not just named tiers).
2. Whether "suspend" means revoking Supabase auth access, setting a
   `profiles.status` flag checked by `requireAuth`, or both.

Build order: schema + `lib/requireAdmin.js`-style middleware first,
*then* the CLI commands — a CLI wrapper around nothing would just be a
worse version of hand-editing the `profiles` table in Supabase directly.

## Phase 4 — Billing/subscriptions CLI (backend mostly exists, unexposed)

| Requested commands | Status |
|---|---|
| `rox subscriptions`, `rox invoices`, `rox payments`, `rox coupons`, `rox referrals`, `rox billing forecast`, `rox credits statistics/refill/expire` | next (mostly) |

`stripeWebhook.js`, `createCheckoutSession.js`, `createTopupSession.js`,
and the credit ledger (`04_deduct_credit_function.sql`,
`credit_audit_log`) are real and already handle the money-moving side.
What's missing is a **read** layer for the CLI to call — `coupons` and
`referrals` specifically have no backend at all yet
(`src/modules/billing/growth.js` is a stub per ARCHITECTURE.md's
Referral System / Affiliate Program rows) and need that built first.
`rox credits refill`/`expire` are **mutating** admin actions on a
user's balance — these need an explicit audit-logged function (mirror
`optimizer.applyAction()`'s before/after logging pattern) before a CLI
command calls it, not a direct table UPDATE.

## Phase 5 — Plugins, extensions, marketplace (needs design — do not build)

| Requested commands | Status |
|---|---|
| `rox plugin install/remove/update/list`, `rox extension install/remove/update/list`, `rox extensions` | needs design |

`backend/src/modules/plugins/index.js` exists but `installPlugin()`
throws `not_implemented` **on purpose** — the manifest shape is
defined (`{ key, name, version, tools, permissions }`,
`12_extension_schema.sql`'s `plugin_installations` table exists) but
there is no sandboxing or execution model, and third-party code
running against user data without one is a real security question, not
an engineering-effort one. This phase starts with a design doc
answering: what can a plugin's registered tool actually touch (network?
which tables? rate limits?), and who reviews a plugin before
`is_public`. CLI commands come after that's answered, not before.

## Phase 6 — Notifications, webhooks, API/SDK access

| Requested commands | Status |
|---|---|
| `rox notifications`, `rox webhook list/test`, `rox api status/keys/revoke/generate/usage`, `rox rate limits` | next |

`src/modules/webhooks/index.js` and `src/modules/sdk/index.js` are
registered extension points (ARCHITECTURE.md §4) with tables already
defined (`webhooks`, `api_keys`) but no dispatch/verification logic
implemented yet. `rate limits` is the exception — `lib/rateLimit.js`
and `lib/ipGuard.js` are real and live; a CLI command here is close to
Phase 1-style "just expose what exists."

## Phase 8 — Security, audit, SSL/DNS

| Requested commands | Status |
|---|---|
| `rox security scan`, `rox firewall`, `rox audit logs`, `rox vulnerabilities`, `rox penetration test`, `rox ssl verify/renew`, `rox domains`, `rox dns verify` | needs design |

`lib/ipGuard.js`, `lib/inputValidation.js`, and `credit_audit_log` are
real hardening/audit pieces already, so `rox audit logs` is close to
buildable (read `credit_audit_log` + `optimizer_actions_log`, both
already exist). `rox security scan`/`vulnerabilities`/`penetration
test` are a different kind of thing — running a real scanner (or
shelling out to one) is a legitimate feature, but "fake a scan that
always says OK" is exactly the placeholder pattern to avoid; this
needs a decision on which actual tool/service does the scanning before
any CLI wrapping. SSL/DNS commands depend on how the deployment is
hosted (Railway/Render/custom) — no single implementation covers all of
them without knowing that.

## Phase 9 — Frontend-only settings (multi-word, no backend)

`rox notifications` overlaps Phase 6; things like themes, dark mode,
multi-language UI, keyboard shortcuts (ARCHITECTURE.md's extension
point table, bottom section) are frontend/`profiles` column concerns,
not CLI concerns — not on this roadmap at all, since none of the
original 130 commands actually named them as CLI surface.

## Suggested build order

1. Phase 1 done.
2. Phase 7 done.
3. Phase 2 grouping cleanup (rename/alias only, near-zero effort).
4. Phase 6's `rate limits` slice, then the rest of Phase 6 once
   webhooks/sdk get real dispatch logic.
5. Phase 4's read-only slice (`subscriptions`, `invoices`, `credits
   statistics`) before its mutating slice (`refill`/`expire`), which
   needs the audit-logged mutation function first.
6. Phase 3 (users/roles) — schema decision needed before any code.
7. Phase 8's `audit logs` slice now (data already exists); the
   scan/pentest/SSL slice only after picking a concrete tool.
8. Phase 5 (plugins) last, and only after the sandboxing design doc is
   written and reviewed — this is the one phase where "not yet" is the
   correct answer for the foreseeable future, not just "not yet built."
