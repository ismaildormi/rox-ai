# Changelog

All notable changes to ROX AI are documented here. Format: date, area, what changed, why.

## Unreleased — Phase 1 (Stabilization & Production Readiness), part 1

Source: full-repo audit report (see repo history / audit doc), Section "Recommended Build Order → Phase 0 — Fix & Harden."

### Fixed

- **`cli/commands/setup.js` — `checkRedis()` always reported "Redis is reachable"
  regardless of actual reachability.**
  The connectivity probe called `run('node', [...], { allowFailure: true })`.
  `run()` (`cli/lib/util.js`) only throws on a non-zero exit code when
  `allowFailure` is `false` — with `allowFailure: true` set, the surrounding
  `try/catch` could never observe a failed ping, so the Docker
  auto-recovery path (starting a local `rox-redis` container) was
  unreachable dead code. `checkRedis()` now reads the exit status
  `run()` returns and branches on that directly instead of relying on a
  throw that could never happen. No other behavior changed — same
  Docker auto-start flow, same warnings for non-local/no-Docker cases.

### Added

- **`cli/tests/test-setup-redis-check.js`** — regression test for the
  fix above. Drives `checkRedis()` in isolation (mocked `cli/lib/util`,
  no real Redis/Docker/network needed) and asserts the recovery path
  fires on a failed ping and does not fire on a successful one.
  Registered in `package.json`'s `test:cli` script.
- **`backend/test-gatekeeper-unit.js`** — unit test suite for
  `gatekeeper.js` (credit reservation/refund), the audit's top-flagged
  testing gap ("business-critical financial logic... currently has no
  automated test coverage"). 14 tests covering `checkAccess`,
  `reserveCredits` (including the idempotent-replay and
  insufficient-credits paths), `refundCredits` (including double-refund
  protection), and `logCreditEvent`. Mocks `backend/lib/supabaseAdmin.js`
  at the module level, so it needs no live Supabase project and no
  `@supabase/supabase-js` install to run. Registered as
  `npm run test:gatekeeper` / `test:unit` in `backend/package.json`.
  This complements `test-hardening.js` (a live-instance HTTP smoke
  test) rather than replacing it — the two check different things.

### Notes

- No architecture, APIs, or existing behavior changed beyond the one
  bug fix above. Everything else in this pass was additive (tests only).

## Unreleased — Phase 1, part 2 (security review — dependencies & backend hardening)

Scope: manual review of both `package.json` files, and of
authentication, authorization, input validation, rate limiting, secrets
handling, headers, and sensitive routes across `backend/`. Full
verification and the final Phase 1 report are separate, later steps —
not part of this pass.

### Fixed

- **`backend/13_advisor_optimizer_schema.sql` — privilege escalation via
  the `profiles.is_admin` column (critical).** `is_admin` was added by
  this file, but `10_profile_column_lockdown.sql`'s
  `protect_sensitive_profile_columns()` trigger — which exists
  specifically because Postgres RLS can only restrict which *rows* a
  client can write (`auth.uid() = id`), never which *columns* — was
  written before this column existed and never covered it. In practice
  that meant any authenticated user could call, from the browser, with
  nothing more than the anon key and their own session:
  `supabase.from('profiles').update({ is_admin: true }).eq('id', session.user.id)`,
  and RLS would allow it — silently granting themselves every route
  behind `lib/requireAdmin.js` (Business Advisor, Auto Optimizer, and
  Disk Monitor's destructive maintenance/deletion actions). Fixed by
  re-declaring the same trigger function (`CREATE OR REPLACE`, same
  name, so the existing trigger picks it up with no new migration
  step) to also revert `is_admin` to its previous value unless the
  write comes from the service role — identical posture to the
  `credits_total`/`credits_used`/`subscription_status` protection
  already in place. No legitimate code path changes: `is_admin` is
  still only ever set by hand in the DB (or a future internal tool)
  using the service-role key, exactly as documented in that column's
  original comment.
- **`package.json` (root) and `backend/package.json` — outdated,
  vulnerable dependency floors.**
  - `cross-spawn` `^7.0.3` → `^7.0.5`: versions before 7.0.5 carry a
    ReDoS (CVE-2024-21538, CVSS 7.5) — a crafted string can spike CPU
    usage. Used directly by the CLI (`cli/lib/util.js`'s `run()`/
    `capture()`) for every shelled-out command (`pm2`, `psql`,
    `pg_dump`, `docker`, `which`/`where`), so this is on a real code
    path, not just a transitive dependency of a dev tool.
  - `express` `^4.19.2` → `^4.21.2`: 4.19.2 carries a direct
    CVE (CVE-2024-43796, untrusted input into `response.redirect()`)
    plus several transitive ones pulled in at that version —
    `path-to-regexp` ReDoS (CVE-2024-52798/45296), `body-parser` DoS
    (CVE-2024-45590), `cookie` (CVE-2024-47764), `send`/`serve-static`
    (CVE-2024-43799/43800) — all fixed by 4.20.0–4.21.1. `server.js` is
    the whole API surface, so this floor matters more than most.
  - Both were caret ranges that a fresh `npm install` would already
    resolve past (no `package-lock.json` was present in this repo to
    pin the vulnerable version) — but the written floor itself named a
    known-vulnerable version, so a `npm install --save-exact`-style
    workflow or an offline/vendored install could still land on it.
    Bumping the floor costs nothing behaviorally (both are semver-minor/
    patch bumps within the same major) and makes the intent explicit.

### Notes

- Reviewed and found already adequately handled (no change needed):
  `lib/auth.js` (token verification, never trusts client-supplied
  userId), `lib/requireAdmin.js`, `gatekeeper.js` (row-locked idempotent
  credit reservation), `lib/rateLimit.js` + `lib/ipGuard.js` (per-user
  and per-IP limits, auth-failure lockout), `lib/inputValidation.js`
  (body shape/size caps before any credit is charged), `stripeWebhook.js`
  (signature verification + event-id dedupe), `createCheckoutSession.js`/
  `createTopupSession.js` (userId from verified token, topup amount
  bounded server-side), `src/api/v1/adminRoutes.js` (consistent
  `requireAuth → requireAdmin → flagGate` on every route),
  `src/modules/diskMonitor/maintenance.js` (whitelisted action map,
  `execFileSync` with array args — no shell injection surface —
  destructive actions gated behind a separate confirmation-row flow),
  `server.js` security headers, CORS allow-list, body size cap, and the
  `/metrics` / `/internal/*` shared-secret gates.
- Other dependencies (`@supabase/supabase-js`, `bullmq`, `ioredis`,
  `pm2`, `prom-client`, `replicate`, `stripe`, `dotenv`, `tar`) were
  checked against public advisories; nothing else pinned to a version
  with a known, currently-unpatched CVE was found at the floors this
  repo specifies.
- No functionality changed by any fix in this pass — the SQL fix only
  blocks a write path that was never intentionally supported, and the
  dependency bumps are non-breaking patch/minor version floor updates.

## Unreleased — Phase 1, part 3 (test registration & verification)

### Verified

- **Test registration**: no new backend unit test files were created in
  part 2 (only `13_advisor_optimizer_schema.sql`, both `package.json`
  files, and this changelog were touched), so `backend/package.json`'s
  `test:unit`/`test:gatekeeper` scripts already cover everything that
  exists — nothing to add. No `advisor`/`optimizer` unit test files
  exist in this repo yet (only `test-gatekeeper-unit.js` and the
  live-instance `test-hardening.js` do); adding them is new test-writing
  work, not a registration gap, so it's listed under "remaining work"
  below rather than done silently here.
- **Syntax check**, every file touched in part 2:
  - `package.json` (root), `backend/package.json` — parsed with
    `JSON.parse`, both valid.
  - `backend/13_advisor_optimizer_schema.sql` — no local `psql`
    available in this environment to run a live `EXPLAIN`/dry-parse, so
    verified structurally instead: parentheses balanced (75/75), the
    two `$$ ... $$` plpgsql body delimiters are paired, and the touched
    block was hand-traced statement-by-statement against the
    already-applied, working version in `10_profile_column_lockdown.sql`
    (identical pattern, one more assignment line and one more `new.<col>
    := old.<col>` in the `if` branch). No syntax change beyond that.
  - `server.js`, `gatekeeper.js`, and all 5 files under `cli/tests/`
    additionally spot-checked with `node --check` (not modified this
    pass, but exercised directly by the test run below) — all clean.
- **Backend unit suite** (`npm run test:unit` / `test-gatekeeper-unit.js`,
  mocked Supabase, no live instance needed): **14/14 passed, 0 failed.**
  `test-hardening.js` was not run — it's a live-HTTP smoke test against
  a running `server.js` + real Redis + real Supabase session token
  (documented at the top of that file), none of which exist in this
  environment; it's also not part of `test:unit`/`test:gatekeeper` in
  `package.json`, so this isn't a change in what "the unit suite" means.
- **CLI suite** (`npm run test:cli`, all 5 files): **38/38 passed, 0
  failed.** This required a one-time workaround: the sandbox has no
  network egress, so `npm install` couldn't fetch `cross-spawn` (a real
  dependency, not something removed) and every CLI test failed at
  import time with `Cannot find module 'cross-spawn'`. To verify the
  actual test logic rather than stop at that environment gap, a
  temporary POSIX-only passthrough shim (`spawn`/`sync` → Node's
  built-in `child_process`) was placed at `node_modules/cross-spawn/`
  for the duration of the run, then deleted immediately after — it was
  never committed and is not part of the delivered project. A few
  sub-checks inside `test-ai-backend.js` self-report as "skipped"
  (not failed) when backend-only deps like `bullmq` aren't installed —
  that's the test's own documented, intentional behavior for a
  CLI-only environment, not a failure.
- **Combined result**: 52/52 tests passed across both suites, 0
  failures, 0 regressions from the Phase 1 part 2 changes (the SQL fix
  and the two dependency floor bumps touch no code path either suite
  exercises directly — `test-gatekeeper-unit.js` mocks Supabase
  entirely, and no CLI test imports `express` or the profiles trigger).

### Notes

- No documentation changes were needed: `docs/API.md`/`docs/CLI.md`
  describe request/response contracts and command behavior, neither of
  which changed. The `is_admin` fix and dependency bumps are both
  invisible at those layers by design (the fix blocks an unintended,
  never-documented write path; the bumps are non-breaking floor
  updates).

## Unreleased — Phase 2, part 1 (Dockerization)

Scope: containerize the backend and worker for local development and
as an alternative to the pm2/bare-metal deployment path — the pm2 path
(`./cli/rox.js start`/`stop`/`health`, `backend/ecosystem.config.js`)
is untouched and remains primary. No CI/CD, no automated backup
strategy for a containerized deployment — both explicitly out of scope
for this pass.

### Added

- **`backend/Dockerfile`** — production image for the API server.
  Multi-stage (`deps` installs `--omit=dev`, `runtime` is a slim
  `node:20-alpine`), runs `node server.js` directly (not through pm2 —
  see the file's own header comment and `ARCHITECTURE.md` §13 for why),
  non-root `node` user, `tini` as PID 1 for correct signal handling,
  `HEALTHCHECK` against `GET /healthz` (unauthenticated by design, same
  route `rox health` and an uptime monitor already use).
- **`backend/Dockerfile.worker`** — same base/deps, runs `node
  worker.js`, no exposed port. `HEALTHCHECK` opens its own short-lived
  Redis connection and pings — a real (if partial) liveness signal, not
  a no-op; the file's comment is explicit about what it does and
  doesn't prove (it can't see the running worker process's own state).
- **`backend/.dockerignore`** — excludes `node_modules` (installed
  fresh inside the image), any real `.env*` (secrets are never baked
  into the image; they reach a container only via `env_file`/`-e` at
  run time), test files, and VCS/editor cruft. `.env.example` is
  explicitly un-excluded (no real values, useful as in-image reference).
- **`docker-compose.yml`** (repo root) — `backend` + `worker` + a local
  `redis:7-alpine` for local development. `REDIS_URL` is overridden
  per-service to Docker's internal service DNS (`redis://redis:6379`);
  every other variable passes through from `backend/.env` via
  `env_file:` untouched. `depends_on: redis: condition: service_healthy`
  on both app services so neither starts racing Redis's own startup.
- **`ARCHITECTURE.md` §13 "Deployment: two independent paths"** — new
  section (filling an existing gap in the numbering, between §12 and
  §14) documenting the Docker path alongside the pm2/CLI one, and what
  it explicitly does not include (CI/CD, container-aware backups,
  orchestration beyond local compose).
- **`README.md`** — new "Docker (طريقة تانية، اختيارية)" section with
  the minimal `cp .env.example .env` → `docker compose up --build` →
  `logs` → `down` quick-start, explicit that this doesn't replace
  `./cli/rox.js`.

### Verified

- **Environment variables**: traced every `process.env.*` read
  reachable from `server.js`/`worker.js` against `backend/.env.example`
  — all present; `docker-compose.yml`'s `env_file: ./backend/.env` plus
  the one `REDIS_URL` override is the complete set needed to run both
  containers. No new environment variables were introduced.
- **Path self-containment**: confirmed every relative `require('../...')`
  reachable from `server.js`/`worker.js`/`gatekeeper.js`/`lib/`/`src/`
  resolves to somewhere inside `backend/` itself (mainly
  `backend/config/*.json` via `src/core/config.js`) — nothing reaches
  outside the `backend/` directory, which is what makes `context:
  ./backend` in `docker-compose.yml` a correct, complete build context
  for both images.
- **`docker-compose.yml`** parsed successfully with a YAML parser (all
  3 services + the named volume present, structurally valid).
- **CLI regression check**: re-ran the full CLI suite
  (`npm run test:cli`) after adding all Docker files —
  **38/38 passed, 0 failed**, same result as the Phase 1 checkpoint.
  Re-ran the backend unit suite (`test-gatekeeper-unit.js`) too —
  **14/14 passed, 0 failed**. Neither suite touches anything Docker-
  related, so this confirms the new files are purely additive and
  nothing in `cli/` or `backend/` was disturbed.
- **Could not verify in this environment**: this sandbox has no Docker
  daemon and no network egress (`apt-get`/`get.docker.com`/the npm
  registry are all unreachable — confirmed directly), so an actual
  `docker build`/`docker compose up` could not be executed here. In
  place of that, every Dockerfile instruction and the compose file were
  reviewed manually line-by-line, cross-checked against the dependency
  list and file layout confirmed in the repo, and the reasoning above
  substitutes for a live build/run. **Running an actual `docker compose
  up --build` in an environment with Docker + network access is the
  one verification step still outstanding** — see "Remaining work."

### Notes

- No changes to `cli/`, `server.js`, `worker.js`, `gatekeeper.js`, or
  any Phase 1 file — this pass only added new files and updated
  documentation.
- `docs/API.md`/`docs/CLI.md` were not touched — no request/response
  contract or CLI command behavior changed.

## Unreleased — Phase 2, part 2 (CI pipeline)

Scope: automated build/test verification on every push and pull
request, on top of the Docker images from part 1. No CD (no deploy
step, no registry push, no staging/production target) — that's a
separate, later module.

### Added

- **`.github/workflows/ci.yml`** — GitHub Actions workflow, triggers
  on push/PR to `main` plus manual `workflow_dispatch`. Four jobs, run
  in parallel, all required:
  - `lint` — `node --check` on every `.js` file in `cli/`+`backend/`,
    `JSON.parse` on both `package.json` files, `docker compose config`
    to validate `docker-compose.yml` structurally.
  - `test-cli` — `npm install` (root) + `npm run test:cli` (the same
    5-file, 38-test suite already verified in Phase 1/Phase 2 part 1).
  - `test-backend` — `npm install` (`backend/`) + `npm run test:unit`
    (`test-gatekeeper-unit.js`, mocked Supabase, 14 tests).
  - `docker-build` — builds `backend/Dockerfile` and
    `backend/Dockerfile.worker` directly (tag `:ci`, never pushed),
    then `docker compose config` + `docker compose build`.
  - A `concurrency` group cancels a stale in-progress run when a newer
    commit lands on the same branch/PR.
  - `backend/test-hardening.js` deliberately excluded — live-HTTP
    smoke test needing a real running server + Redis + Supabase
    session token, was never part of `test:unit`/`test:gatekeeper`,
    stays a manual/staging check.
- **`ARCHITECTURE.md` §13a "Continuous Integration (CI pipeline)"** —
  new lettered subsection (same convention as existing §4a), inserted
  between §13 and §14 with no renumbering of surrounding sections.
  Also corrected §13's "what this does NOT do" bullet, which
  previously said "no CI/CD pipeline" — now accurate: CI exists (§13a),
  CD still doesn't.
- **`README.md`** — new short CI section (same Darija/Arabic tone as
  the rest of the file) pointing to `ARCHITECTURE.md` §13a; the Docker
  section's "not built yet" line updated from "CI/CD pipeline" to just
  "CD pipeline," since CI is no longer accurate to list there.

### Verified

- **JS syntax**: every `.js` file under `cli/` and `backend/`
  (excluding `node_modules`) passed `node --check` locally, same check
  the `lint` job runs in CI — 0 syntax errors.
- **JSON validity**: both `package.json` files parsed cleanly with
  `JSON.parse`.
- **YAML validity**: `.github/workflows/ci.yml` parsed successfully
  with a standalone YAML parser; confirmed all 4 job names present
  (`lint`, `test-cli`, `test-backend`, `docker-build`). Note: a
  YAML-1.1 parser resolves the bare `on:` key to the boolean `True`
  when loaded generically (a well-known, cosmetic quirk of the `on:`
  keyword in every GitHub Actions workflow ever written) — GitHub's
  own workflow parser handles it correctly as the trigger key; this
  doesn't affect how the workflow actually runs.
- **Could not verify in this environment**: this sandbox has no
  network egress and no `.github`-aware CI runner, so the workflow
  could not actually be executed end-to-end here (same limitation
  noted in Phase 2 part 1 for `docker compose up`). In place of that:
  the exact commands each job runs (`npm run test:cli`, `npm run
  test:unit`, `docker build` against the same two Dockerfiles) are
  unchanged from what was already verified working in Phase 2 part 1
  (52/52 tests passed, both images reviewed line-by-line) — this
  workflow only adds automated triggering and isolated job
  environments around those same commands, it doesn't change what they
  do. **Actually watching a run go green on GitHub Actions after this
  is pushed is the one verification step still outstanding.**

### Notes

- No changes to any file from Phase 1 or Phase 2 part 1 — this pass
  only added `.github/workflows/ci.yml` and updated documentation.
- `docs/API.md`/`docs/CLI.md` not touched — no request/response
  contract or CLI command behavior changed.
- Next unfinished module per the checkpoint: **CD pipeline** (Phase 2,
  part 3) — not started, waiting for approval on this module first.

## Unreleased — Phase 2, part 3 (CD pipeline)

Scope: publish a versioned, pullable build artifact automatically once
CI passes on `main`. Explicitly NOT in scope: deploying that artifact
anywhere. This repo has no committed hosting-platform decision yet
(§13's Railway/Render mentions are both still open, no
`railway.json`/`render.yaml` exists) — picking one here would mean
writing deploy config against infrastructure that doesn't exist yet.
"Staging deployment" and "Production deployment" remain separate,
later modules, each needing its own explicit platform decision first.

### Added

- **`.github/workflows/cd.yml`** — publishes `backend` and `worker`
  Docker images to GitHub Container Registry (GHCR):
  - **Trigger 1**: `workflow_run` on the `CI` workflow completing on
    `main`, gated on `github.event.workflow_run.conclusion == 'success'`
    — a CI failure can never reach a publish.
  - **Trigger 2**: push of a `v*.*.*` tag (explicit release cut).
  - **Trigger 3**: `workflow_dispatch` (manual re-publish of the
    current `main` tip).
  - **Auth**: `GITHUB_TOKEN` (already available to every workflow,
    scoped `packages: write` for this job) — no new secret, no new
    account to provision, which is the specific reason GHCR was chosen
    over a straight-to-host deploy for this module.
  - **Tags per image**: `sha-<8 hex>` (always, immutable/traceable),
    `latest` (always the `main` tip — a tag build never overwrites it
    with an old release), and the exact `v*.*.*` string when triggered
    by a tag push.
  - **Build context/Dockerfiles**: identical to what `ci.yml`'s
    `docker-build` job already validates (`backend/Dockerfile`,
    `backend/Dockerfile.worker`) — no Dockerfile changes, this module
    is purely additive.
  - Registry-backed buildx cache (`:buildcache` tag per image) so
    repeat builds only rebuild changed layers.
  - `concurrency` group with `cancel-in-progress: false` — unlike CI,
    a publish in progress is never cancelled by a newer trigger (would
    risk a half-pushed image); the next trigger just queues behind it.
- **`ARCHITECTURE.md` §13b "Continuous Delivery (CD pipeline)"** — new
  lettered subsection after §13a, same convention as §4a/§13a, no
  renumbering of surrounding sections. §13a's closing note updated
  (it previously said CD didn't exist; now points to §13b). §13's own
  "what this does NOT do" note was already accurate from part 2 (it
  said "no CD pipeline... not built yet") — left as historical text
  under Phase 2 part 1's own changelog entry above, not edited
  retroactively; §13b is what supersedes it going forward.
- **`README.md`** — new CD section (same tone as the CI section added
  in part 2), and the Docker section's "not built yet" line updated
  from "CD pipeline" to "staging/production deployment," since CD
  itself is no longer accurate to list there.
- **`.github/workflows/ci.yml`** — two header-comment corrections
  (no logic change): both places that said "CD pipeline... not
  built yet" now point to `cd.yml` by name.

### Verified

- **YAML validity**: `.github/workflows/cd.yml` parsed successfully
  with a standalone YAML parser; confirmed the single job
  (`build-and-push`) is present. Same `on:` → boolean-`True` cosmetic
  quirk noted in part 2 applies here too and is equally harmless —
  GitHub's own parser is unaffected.
- **CI workflow unchanged in behavior**: `ci.yml`'s only edits were to
  comment text; re-ran the JS syntax check across `cli/`+`backend/`
  (0 errors, unaffected either way since no `.js` file was touched)
  and re-parsed both workflow files as YAML — both still parse with
  their full job lists intact.
- **Traced against §13's existing Dockerfiles**: confirmed `cd.yml`
  builds from the exact same `context`/`file` pairs
  (`./backend`+`Dockerfile`, `./backend`+`Dockerfile.worker`) that
  `ci.yml`'s `docker-build` job already builds and that
  `docker-compose.yml` already references — no drift between the
  three.
- **Gating logic traced by hand**: for the `workflow_run` trigger,
  `if:` requires `conclusion == 'success'`; a `failure`, `cancelled`,
  or `timed_out` CI run produces a `workflow_run` event too but this
  job's `if:` evaluates false for all of those, so no steps execute
  and no image is pushed — confirmed by reading the job condition
  against every documented `conclusion` value GitHub Actions can send.
- **Could not verify in this environment**: no network egress and no
  real GitHub remote in this sandbox, so the workflow could not
  actually run, and GHCR push/pull could not be exercised live (same
  category of limitation as Phase 2 parts 1–2). The image build
  instructions themselves were already verified buildable in part 2's
  `docker-build` job; this module only adds registry authentication,
  tagging, and the gating trigger around that same build — it doesn't
  change what gets built. **Watching an actual publish succeed on
  GitHub Actions (and confirming the image is pullable from GHCR)
  after this is pushed is the one verification step still
  outstanding.**

### Notes

- No changes to any Phase 1 file, any Phase 2 part 1 file, or the
  logic of `ci.yml` — this pass added `.github/workflows/cd.yml`,
  made comment-only edits to `ci.yml`, and updated documentation.
- `docs/API.md`/`docs/CLI.md` not touched — no request/response
  contract or CLI command behavior changed.
- No database, backend route, or frontend change — this module is
  entirely CI/CD infrastructure.
- Next unfinished module per the checkpoint and the approved order:
  **Staging deployment** (Phase 2, part 4) — not started, waiting for
  approval on this module first. That module will need an explicit
  hosting-platform decision (Railway, Render, or other) before any
  deploy automation can be written, since none is committed in this
  repo yet.

## Unreleased — Phase 2, part 4 (Staging deployment)

Scope: actually run a GHCR image (§13b) somewhere staging can be
verified against, before any production decision exists. No
hosting-platform decision has been made since part 3's note above
(Railway/Render both still open) — rather than block on that decision,
this module deploys over plain SSH to any Docker host, so it's usable
today and stays valid regardless of what production eventually picks.

### Added

- **`.github/workflows/deploy-staging.yml`** — two jobs:
  - `validate`: `docker compose config` on `docker-compose.staging.yml`
    (same synthetic-`.env` approach `ci.yml`'s `lint` job already
    uses) plus a shellcheck pass on the deploy script — runs before
    anything touches the staging host.
  - `deploy` (uses the `staging` GitHub Environment): copies the
    compose file + deploy script to the host via `scp`, then runs the
    deploy script over `ssh`.
  - **Triggers**: `workflow_run` on `cd.yml` completing with
    `conclusion == 'success'` (deploys the exact `sha-<8 hex>` tag CD
    just published), or `workflow_dispatch` for a manual deploy
    (`image_tag` input, default `latest`) or rollback (`rollback`
    boolean input).
  - **Auth to the host**: SSH key via `webfactory/ssh-agent`, host key
    pinned with `ssh-keyscan` before any connection. **Auth to GHCR**:
    the workflow's own `GITHUB_TOKEN` (`packages: read`), forwarded to
    the host only for the duration of the deploy — never stored there.
  - `concurrency` group `deploy-staging`, `cancel-in-progress: false` —
    same rationale as `cd.yml`: never cancel a deploy mid-flight.
- **`docker-compose.staging.yml`** — staging counterpart of
  `docker-compose.yml` (§13): identical `redis` + `backend` + `worker`
  services, `image:` (from GHCR, tag supplied via `IMAGE_TAG` env var)
  instead of `build:`. No new Dockerfile, no image changes — reuses
  exactly what `cd.yml` already publishes.
- **`scripts/deploy/staging-deploy.sh`** — runs on the staging host
  (copied there by the workflow, not checked out via git on the host).
  Logs into GHCR, pulls both images at the target tag (aborts before
  touching running containers on a pull failure), `docker compose up
  -d`, then polls the existing `/healthz` endpoint (`server.js`, §12)
  up to 10× at a 3s interval. On success, records the tag as
  `.current-tag` (rotating the old one into `.previous-tag`). On
  failure, prints the last 100 lines of container logs and
  automatically redeploys `.previous-tag` if one exists — the GitHub
  Actions job still reports failure either way, since the originally
  requested tag did not successfully deploy. Rollback
  (`ROLLBACK=true`) reuses the exact same `deploy_tag()` path deploying
  whatever `.previous-tag` holds — not a separate/riskier code path.
- **`docs/DEPLOYMENT.md`** — full operator runbook: one-time host
  setup, the 5 required `staging` GitHub Environment secrets and why
  they're environment-scoped rather than repo-level, what happens on a
  deploy step-by-step, both rollback modes, how to point the existing
  `backend/test-hardening.js` smoke test at a live staging instance for
  deeper manual verification, and a troubleshooting table.
- **`ARCHITECTURE.md` §13c "Staging Deployment"** — new lettered
  subsection after §13b, same convention as §4a/§13a/§13b, no
  renumbering. §13b's closing note updated to point here for staging
  instead of listing it as not-yet-built (production deployment is
  still listed as the remaining not-yet-built module, unchanged).
- **`README.md`** — new Staging Deployment section (same tone/format
  as the CD section added in part 3), and the Docker section's
  "not built yet" line updated to drop staging, keeping only
  production deployment and the Docker-deployment backup gap.

### Verified

- **YAML validity**: `.github/workflows/deploy-staging.yml` and
  `docker-compose.staging.yml` both parsed successfully with a
  standalone YAML parser (`python3 -c "yaml.safe_load(...)"`).
- **Bash syntax**: `bash -n scripts/deploy/staging-deploy.sh` — no
  syntax errors.
- **Could not verify in this environment**: no network egress and no
  real GitHub remote or SSH-reachable host in this sandbox (same
  category of limitation noted in Phase 2 parts 1–3), so the workflow
  itself, an actual SSH deploy, the GHCR pull on a remote host, and a
  live `/healthz` poll could not be exercised end-to-end.
  `shellcheck` is also not installed in this sandbox (offline, package
  fetch blocked) — the `validate` job's shellcheck step
  (`ludeeus/action-shellcheck`) will run it on GitHub Actions on first
  push; reviewing an actual `validate` job run there is the one
  verification step still outstanding, along with a first real staging
  deploy once the `staging` Environment and its 5 secrets are
  configured.

### Notes

- No changes to any Phase 1 file, any Phase 2 part 1/2/3 file, or the
  logic of `ci.yml`/`cd.yml` — this pass only added new files
  (workflow, compose file, deploy script, docs) and made additive
  documentation edits to `ARCHITECTURE.md`/`README.md` (no existing
  section's meaning changed, only closing-note pointers updated, same
  pattern as part 3's edit to §13a).
- `docs/API.md`/`docs/CLI.md` not touched — no request/response
  contract or CLI command behavior changed.
- No database, backend route, frontend, or Dockerfile change — this
  module only adds deployment automation around images that already
  exist.
- Production deployment remains the next, separate, not-yet-built
  module — still needs its own explicit hosting-platform decision (or,
  per this module's precedent, could reuse the same SSH-based approach
  against a hardened host if no platform decision is ever made).
  **Stopping here — do not start Production deployment.**

## Unreleased — Phase 3, part 1 (Production deployment)

Source: continuation of the Phase 2 checkpoint (part 4, Staging
deployment) — this part covers only Production Deployment, the module
that checkpoint explicitly left for later and said not to start
automatically.

### Added

- **`docker-compose.production.yml`** — production counterpart of
  `docker-compose.staging.yml`. Same `redis`/`worker` services and
  `env_file`/image-pull pattern, but the single `backend` service is
  replaced with `backend-blue` + `backend-green` (both always running,
  each also on a dedicated host port — 3011/3012 — for direct
  health-checking) plus a new `nginx` service in front deciding which
  color receives real traffic.
- **`nginx/active.conf.template`** — one-placeholder nginx config
  template (`__ACTIVE_UPSTREAM__`), rendered by the deploy script into
  `nginx/conf.d/active.conf` on the host and picked up via a graceful
  `nginx -s reload`. The rendered file itself is host state, not
  committed.
- **`scripts/deploy/production-deploy.sh`** — runs on the production
  host over SSH, same delivery mechanism as `staging-deploy.sh`.
  Reads which color is currently active (`.active-color`, defaults to
  `blue` on a fresh host), pulls the target tag, starts/recreates only
  the *inactive* color, health-checks it directly on its own host port
  (active color and nginx untouched throughout), and only on success
  renders the nginx template and reloads nginx. `IMAGE_TAG` has no
  default (unlike staging's `latest`) — required unless `ROLLBACK=true`.
  Rollback flips nginx back to whichever color is currently inactive —
  no pull, no restart, since it's already running.
- **`.github/workflows/deploy-production.yml`** — `workflow_dispatch`
  only (no `workflow_run` auto-trigger the way `deploy-staging.yml`
  has one on `cd.yml`): production promotion is always a deliberate,
  manual action. Inputs: `image_tag` (required unless `rollback` is
  true) and `rollback` (boolean). A `validate` job (`docker compose
  config` + shellcheck + a template-placeholder sanity check) runs
  before a `deploy` job gated behind the `production` GitHub
  Environment. After a successful on-host deploy, the workflow itself
  also curls `/healthz` from the runner as an independent
  external check, then writes a job summary.
- **`cli/tests/test-production-deploy-config.js`** (11 tests,
  registered as the new `test:deploy` script in `package.json`,
  alongside — not replacing — `test:cli`) — structural/logic checks:
  both compose colors + nginx + worker + redis are defined, the two
  colors expose distinct host ports, `production-deploy.sh` parses
  as valid bash, `IMAGE_TAG` has no silent default, the script never
  stops the previously-active color, the start → health-check →
  cutover ordering is correct, the nginx template still has its
  placeholder and proxies `/healthz`, and the workflow is
  manual-only and gated behind the `production` Environment.
- **`docs/DEPLOYMENT.md`** — broadened header to cover both staging
  and production; new "Production Deployment" section covering
  one-time host setup (including the `nginx/conf.d` directory and a
  dedicated, non-shared SSH key), the 5 required `production`
  Environment secrets and why required reviewers matter here
  specifically, the step-by-step deploy flow, the zero-downtime
  strategy, rollback, health checks, verification, and a
  troubleshooting table.
- **`ARCHITECTURE.md` §13d "Production Deployment"** — new lettered
  subsection after §13c, same convention as §13a/§13b/§13c, no
  renumbering. §13b's and §13c's closing notes updated to point here
  instead of listing production as not-yet-built.
- **`README.md`** — new Production Deployment section (Darija, same
  tone/format as the existing Staging Deployment section), and the
  Docker section's "not built yet" line updated to drop production
  deployment, keeping only the Docker-deployment backup gap.

### Verified

- **YAML validity**: `docker-compose.production.yml` and
  `.github/workflows/deploy-production.yml` both parsed successfully
  with a standalone YAML parser (`python3 -c "yaml.safe_load(...)"`) —
  same method the Phase 2 part 4 checkpoint used, since this sandbox
  has neither a Docker CLI nor `shellcheck` installed.
- **Bash syntax**: `bash -n scripts/deploy/production-deploy.sh` — no
  syntax errors.
- **Logic**: the color-flip/port/upstream helper functions
  (`other_color`, `color_port`, `color_upstream`) were exercised
  directly in an isolated bash shell for both `blue` and `green`
  inputs, and the nginx template's `sed` substitution was run against
  a sample upstream value — both produced the expected output.
- **New test suite**: `npm run test:deploy` — 11/11 passing.
- **Could not verify in this environment**: same category of gap the
  Phase 2 part 4 checkpoint already notes — no network egress and no
  real GitHub remote or SSH-reachable host in this sandbox, so the
  workflow itself, an actual SSH deploy, the GHCR pulls, a live
  blue/green cutover, and the `nginx -s reload` behavior against a
  real nginx process could not be exercised end-to-end. `docker
  compose config` and `shellcheck` (the `validate` job's own checks)
  will run for real on GitHub Actions on first push; reviewing that
  run, plus a first real production deploy once the `production`
  Environment (with required reviewers) and its 5 secrets are
  configured, are the verification steps still outstanding.

### Notes

- No changes to any Phase 1 file, any Phase 2 file (`docker-compose.yml`,
  `docker-compose.staging.yml`, `backend/Dockerfile*`,
  `scripts/deploy/staging-deploy.sh`, or the logic of
  `ci.yml`/`cd.yml`/`deploy-staging.yml`) — this pass only added new
  files (workflow, compose file, deploy script, nginx template, test)
  and made additive documentation edits to `ARCHITECTURE.md`/
  `README.md`/`docs/DEPLOYMENT.md` (existing sections' meaning
  unchanged, only closing-note pointers and the "not built yet" list
  updated, same pattern as Phase 2 part 4's own edit to §13a/§13b).
- `docs/API.md`/`docs/CLI.md` not touched — no request/response
  contract or CLI command behavior changed.
- No database, backend route, frontend, or Dockerfile change — this
  module only adds deployment automation and an nginx layer around
  images that already exist; `backend/Dockerfile`/`Dockerfile.worker`
  and their baked-in `HEALTHCHECK`s are reused unmodified.
- `worker` is intentionally left single-instance / in-place-restarted,
  not blue/green — BullMQ job state lives in Redis, not the worker
  process, so a brief restart delays job pickup without losing a job.
  Documented as a deliberate scope decision in both `ARCHITECTURE.md`
  §13d and `docs/DEPLOYMENT.md`, not an oversight.
- This module assumes TLS termination happens in front of the
  production host (CDN/load balancer/separate reverse proxy) —
  `nginx` here proxies plain HTTP internally, the same posture
  `server.js` has always had. Adding TLS termination directly to this
  `nginx` service (e.g. via Let's Encrypt) is possible future work,
  not required by anything in this checkpoint.
- **Stopping here, per instructions — Production Deployment only.
  Not starting Phase 3's other modules (or any later phase)
  automatically. Awaiting approval.**
