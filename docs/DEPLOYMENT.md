# Deployment

This document is the operator runbook for both
`.github/workflows/deploy-staging.yml` (below) and
`.github/workflows/deploy-production.yml`
(see [Production Deployment](#production-deployment) further down).
For the architectural rationale (why SSH, why no platform was picked),
see `ARCHITECTURE.md` §13c (staging) and §13d (production). For CI/CD
(build, test, publish to GHCR — everything upstream of both), see
§13a/§13b and `docs/` mentions there.

## What this is, in one paragraph

After `cd.yml` publishes `backend`/`worker` images to GHCR, this
workflow deploys those images to a staging host you control, over
plain SSH. It's provider-agnostic on purpose: this repo has not yet
decided on Railway/Render/anything else for real hosting, so rather
than guess, staging targets **any machine with Docker on it** — a
$5 VPS, a spare box, a droplet. Whatever platform is chosen later for
production can pull the exact same GHCR images.

## One-time host setup

On the staging host:

1. Install Docker + Docker Compose v2.
2. Create a deploy directory, e.g. `/opt/rox-ai-staging`. This is the
   value you'll put in the `STAGING_DEPLOY_DIR` secret below — the
   workflow copies `docker-compose.staging.yml` and
   `scripts/deploy/staging-deploy.sh` into it on every run, so nothing
   needs to be `git clone`d on the host.
3. Inside that directory, copy `backend/.env.example` to `.env` and
   fill in real staging values (Supabase project, Stripe **test** keys,
   etc.) — the same `env_file` convention `backend/.env` already uses
   for local/dev. This file is created once, by hand, on the host. It
   is **never** committed and **never** passed through GitHub Actions —
   only SSH access credentials travel through the pipeline, not app
   secrets.
4. Create (or reuse) a dedicated SSH key pair for deployments. Add the
   public key to that host's `~/.ssh/authorized_keys` for the deploy
   user. The private key goes into the `STAGING_SSH_KEY` secret below.

## GitHub Environment: `staging`

Create a GitHub Environment named exactly `staging`
(repo → Settings → Environments) and add these secrets to it (not to
repo-level secrets — keeping them environment-scoped means they're
only readable by jobs that declare `environment: staging`, and lets
you add required reviewers/wait timers on this environment later
without touching anything else):

| Secret | Example | Notes |
|---|---|---|
| `STAGING_HOST` | `203.0.113.10` or `staging.example.com` | reachable over SSH |
| `STAGING_SSH_USER` | `deploy` | user the key above is authorized for |
| `STAGING_SSH_KEY` | (private key, PEM) | paired with the `authorized_keys` entry above |
| `STAGING_SSH_PORT` | `22` | omit only if you also drop the default in the workflow — currently required |
| `STAGING_DEPLOY_DIR` | `/opt/rox-ai-staging` | absolute path from step 2 above |

No GHCR credential secret is needed — the workflow passes its own
job-scoped `GITHUB_TOKEN` (with `packages: read`) to the staging host
for the duration of the deploy, which is enough to `docker login ghcr.io`
and pull the two images. It's never stored on the host.

## What happens on a deploy

1. **Trigger**: automatically after `cd.yml` succeeds (deploys the
   exact `sha-<8 hex>` tag CD just published), or manually via
   **Actions → Deploy to Staging → Run workflow** with a chosen tag.
2. **validate job**: parses `docker-compose.staging.yml` structurally
   and shellchecks `scripts/deploy/staging-deploy.sh` — no staging
   host involved yet, fails fast on config mistakes.
3. **deploy job**: copies the compose file + deploy script to the host,
   then runs the deploy script over SSH, which:
   - logs into GHCR,
   - pulls both images at the target tag (a pull failure aborts here —
     currently running containers are never touched),
   - runs `docker compose up -d`,
   - polls `GET /healthz` on the backend container (up to 30s by
     default) — this is the same `/healthz` endpoint `server.js`
     already exposes for `rox health`/an orchestrator, no new code,
   - on success, records the tag as "current" (and the previous
     "current" as "previous", for rollback),
   - on failure, prints the last 100 lines of container logs, then
     **automatically redeploys the last known-good tag** — see
     Rollback below.
4. **Job summary**: which tag was requested, whether it passed, and
   (on failure) a pointer to the log line confirming whether an
   auto-rollback succeeded.

## Rollback strategy

Two layers:

- **Automatic**: built into every deploy. If the newly deployed tag
  never passes its health check, the script immediately redeploys
  whatever tag was last known-good (tracked in a `.previous-tag` file
  in the deploy directory) — staging is not left running a broken
  build. The GitHub Actions job for that run still shows **failed**,
  on purpose: the tag you asked for didn't actually deploy, even
  though staging itself recovered. Check the deploy step's log for a
  line starting with `Automatic rollback` to see whether that
  recovery itself succeeded.
- **Manual**: trigger the workflow by hand with **Rollback: true**
  (the `image_tag` input is ignored in this mode). This redeploys
  whatever is currently in `.previous-tag` on the host, through the
  exact same pull → health-check path as a normal deploy — a rollback
  is just a deploy of an older tag, not a special code path with its
  own risks.

Only one level of history is kept (current + previous), by design —
if you need to go back further than that, deploy that exact tag
explicitly via `workflow_dispatch` (every image is still in GHCR,
tagged `sha-<8 hex>`, so any past commit's build is always available).

## Manual verification against a running staging instance

Once staging is up, `backend/test-hardening.js` (documented in
`ARCHITECTURE.md` §13a as a manual/staging-only check — it deliberately
trips the IP-block guard, so it is intentionally **not** run
automatically by any pipeline) can be pointed at it directly:

```
BASE_URL=https://your-staging-host:3001 REDIS_URL=<staging REDIS_URL> node backend/test-hardening.js
```

Run this from a machine whose IP you don't mind being temporarily
rate-limited (see the script's own header comment) — not from a
shared CI runner's IP.

## Troubleshooting

- **`validate` job fails on `docker compose config`**: almost always a
  YAML/variable-substitution mistake in `docker-compose.staging.yml`
  itself — nothing host-specific, safe to iterate on locally.
- **SSH step fails**: check `STAGING_SSH_KEY` is the *private* key
  (not `.pub`), and that the corresponding public key is actually in
  the target user's `authorized_keys` on `STAGING_HOST`.
- **Pull fails inside the deploy script**: usually means the
  `packages: read` permission is missing from the workflow (already
  set in `deploy-staging.yml` — check nothing removed it) or the image
  tag doesn't exist yet in GHCR (e.g. `cd.yml` for that commit hasn't
  finished publishing).
- **Health check times out but containers are running**: check
  `docker compose -f docker-compose.staging.yml logs backend` on the
  host directly — usually a missing/wrong value in the staging `.env`
  (Supabase URL/key are the two `/healthz` itself checks).

# Production Deployment

This section is the operator runbook for
`.github/workflows/deploy-production.yml`. For the architectural
rationale (why blue/green instead of staging's in-place restart),
see `ARCHITECTURE.md` §13d.

## What this is, in one paragraph

Production deploys a specific, explicitly-named GHCR image tag to a
production host over SSH — same provider-agnostic "any host with
Docker" posture as staging, but with two changes that matter once real
users are involved: (1) the cutover is **blue/green**, so a deploy
never has a window where no healthy backend is serving traffic, and a
failed deploy has *zero* production impact rather than triggering an
automatic rollback of something that was already live; and (2) the
workflow is **manual-only** — nothing about a successful CI/CD run or
a successful staging deploy triggers a production deploy by itself. A
human names an exact tag and the `production` GitHub Environment's
approval gate has to clear before anything reaches the host.

## One-time host setup

On the production host, in addition to everything staging's setup
already covers (Docker + Compose v2, a deploy directory, a hand-created
`.env`, an SSH key pair):

1. Create the deploy directory, e.g. `/opt/rox-ai-production`. This is
   the value for the `PRODUCTION_DEPLOY_DIR` secret below. The workflow
   copies `docker-compose.production.yml`,
   `scripts/deploy/production-deploy.sh`, and
   `nginx/active.conf.template` into it on every run.
2. Inside that directory, copy `backend/.env.example` to `.env` and
   fill in real **production** values (Supabase project, Stripe **live**
   keys, etc.) — same `env_file` convention as staging's `.env`. Never
   committed, never passed through GitHub Actions.
3. `mkdir -p nginx/conf.d` once, by hand, inside the deploy directory.
   `production-deploy.sh` renders `nginx/conf.d/active.conf` from the
   template on every deploy; the directory just needs to already exist.
4. A dedicated SSH key pair for production deploys — **do not reuse
   the staging key**. Add the public key to the production host's
   `~/.ssh/authorized_keys`; the private key goes into
   `PRODUCTION_SSH_KEY` below.
5. First-ever deploy on a fresh host: run `production-deploy.sh`
   manually once (or trigger the workflow once) with any tag — the
   script defaults the "current active color" to `blue` when
   `.active-color` doesn't exist yet, so the very first run correctly
   treats `green` as the target to stand up and verify before nginx
   ever routes to it.

## GitHub Environment: `production`

Create a GitHub Environment named exactly `production`
(repo → Settings → Environments), add the 5 secrets below to it, and —
unlike `staging` — **add required reviewers to this environment**.
That approval gate is the "deployment protection" layer: even a
correctly-triggered `workflow_dispatch` run with a valid tag waits for
a human to approve the `deploy` job before it can touch the host.

| Secret | Example | Notes |
|---|---|---|
| `PRODUCTION_HOST` | `prod.example.com` | reachable over SSH |
| `PRODUCTION_SSH_USER` | `deploy` | user the key above is authorized for |
| `PRODUCTION_SSH_KEY` | (private key, PEM) | dedicated key, not shared with staging |
| `PRODUCTION_SSH_PORT` | `22` | required, same as staging |
| `PRODUCTION_DEPLOY_DIR` | `/opt/rox-ai-production` | absolute path from setup step 1 |

As with staging, no GHCR credential secret is needed — the workflow's
own job-scoped `GITHUB_TOKEN` (`packages: read`) authenticates the
host's `docker login ghcr.io` for the duration of the deploy.

## What happens on a deploy

1. **Trigger**: manual only — **Actions → Deploy to Production → Run
   workflow**, with `image_tag` (required, unless `rollback: true`) and
   `rollback` (boolean, default `false`) inputs. There is no
   `workflow_run` auto-trigger — a passing CD run or staging deploy
   never causes a production deploy by itself.
2. **`validate` job**: `docker compose config` on
   `docker-compose.production.yml`, shellchecks
   `scripts/deploy/production-deploy.sh`, and confirms
   `nginx/active.conf.template` still has its substitution placeholder
   — all before any SSH connection, same fail-fast posture as staging's
   `validate` job.
3. **`deploy` job**: gated behind the `production` Environment's
   required reviewers. Once approved: copies the compose file, deploy
   script, and nginx template to the host, then runs
   `production-deploy.sh` over SSH, which:
   - logs into GHCR,
   - reads which color (`blue`/`green`) is currently active,
   - pulls both images at the target tag,
   - starts/recreates **only the inactive color** with the new image —
     the active color and nginx are untouched during this step,
   - polls that inactive color's own dedicated host port (`3011` for
     blue, `3012` for green) directly, bypassing nginx entirely, up to
     `HEALTH_RETRIES × HEALTH_INTERVAL_SECONDS` (defaults 15×3s — more
     patient than staging, since nothing is at risk yet),
   - **only if that passes**: renders `nginx/conf.d/active.conf` to
     point at the newly-verified color and gracefully reloads nginx
     (`nginx -s reload` — in-flight connections finish against the old
     color, new connections get the new one immediately),
   - updates `worker` in place afterward (a brief restart — acceptable,
     see "Zero-downtime deployment strategy" below),
   - leaves the **previous** color running (not stopped) — this is
     what makes a rollback instant.
4. **Post-deploy external verification**: the workflow itself curls
   `/healthz` from outside the host (not just the on-host check inside
   the script) — catches a firewall/DNS/nginx-port mismatch that a
   `localhost` check on the host wouldn't.
5. **Job summary**: rollback flag, tag requested, and pass/fail.

## Zero-downtime deployment strategy

Blue/green with an nginx reverse proxy in front, as opposed to
staging's single-container in-place restart:

- `backend-blue` and `backend-green` (`docker-compose.production.yml`)
  are **both always running**. Exactly one is "active" at a time —
  nginx (`nginx/active.conf.template` → `nginx/conf.d/active.conf`)
  decides which one receives real traffic.
- A deploy only ever touches the *inactive* color until it's fully
  verified healthy. The currently-active color and nginx are not
  touched at all until that verification passes — so a failed deploy
  has **zero production impact**, not "impact followed by an automatic
  rollback" the way staging's single-container model requires.
- Cutover is an `nginx -s reload` — a graceful reload, not a restart:
  requests already in flight against the old color finish there; new
  requests get the new color from the moment the reload completes.
  No request is ever sent to a stopped or restarting container.
- `worker` is a single instance, updated in place with a brief restart
  window. This is a deliberate scope decision, not an oversight: unlike
  the API server, the worker has no client waiting on an open HTTP
  connection — BullMQ job state lives in Redis (see `backend/worker.js`,
  `backend/lib/queue.js`), so a restart delays in-flight job pickup by
  at most a few seconds, it does not drop a job or lose its state.
  Making the worker blue/green too is possible future work if job
  latency during a deploy ever becomes something worth engineering
  around, but nothing today requires it.

## Rollback strategy

Two layers, same as staging conceptually, but the mechanics differ
because both colors are always running:

- **Manual rollback (primary mechanism)**: trigger the workflow with
  `rollback: true` (`image_tag` is ignored). `production-deploy.sh`
  health-checks whatever color is currently *inactive* — normally the
  color that was active immediately before the last deploy — and, if
  it's healthy, flips nginx back to it. **No pull, no container
  restart, no wait**: the rollback target was already serving
  production traffic minutes/hours ago, so this is close to
  instantaneous. If that inactive color isn't actually healthy (e.g.
  it was never started, or has since been overwritten by a newer
  deploy attempt), the script refuses and leaves the current active
  color untouched — a rollback can never make things worse than a
  no-op.
- **Automatic (implicit)**: because a failing deploy never reaches the
  cutover step, there is nothing to automatically roll back *from* —
  the "rollback" staging needs to recover from a bad in-place restart
  simply doesn't apply here. A production deploy either cuts over to a
  verified-healthy color, or it doesn't cut over at all.
- **Beyond one step back**: only one previous color's state is
  implicitly available (whatever was active before the last deploy).
  To go back further, deploy that exact historical `sha-<8 hex>` tag
  explicitly via `workflow_dispatch` — every build CD ever published
  stays in GHCR, same as staging.

## Health checks

- **Pre-cutover** (`production-deploy.sh`): polls the *inactive*
  color's dedicated host port (`3011`/`3012`) directly — this is the
  same unauthenticated `/healthz` `server.js` exposes for `rox
  health`/staging/an orchestrator (checks Redis + Supabase
  reachability, see `backend/server.js`), no new app code.
- **Container-level** (`docker-compose.production.yml`): backend and
  worker images already bake in a `HEALTHCHECK` (see
  `backend/Dockerfile`, `Dockerfile.worker`) — unchanged from staging.
  The `nginx` service has its own `HEALTHCHECK` too (a local `wget` to
  `/healthz` through nginx itself), so `docker ps`/an orchestrator can
  see nginx-level health, not just each backend container's.
- **Post-deploy** (`deploy-production.yml`): an external curl to
  `/healthz` from the GitHub Actions runner, independent of anything
  running on the host.

## Deployment verification

A deploy is only ever considered successful if the health-check step
above passes *before* cutover — an unhealthy inactive color never gets
traffic pointed at it, and the job fails loudly (with the target
color's last 100 log lines) rather than silently leaving something
half-deployed. Combined with the external post-deploy curl, there are
three independent confirmations a deploy actually worked: the on-host
pre-cutover check, the successful `nginx -s reload` exit code, and the
runner-side external check.

For deeper manual verification against a live production instance, the
same caveat staging's runbook already gives for `backend/test-hardening.js`
applies doubly here — that script deliberately trips the IP-block
guard, so it should never be pointed at production casually. If you do
need to (e.g. after a security-relevant change), run it against
staging first.

## Troubleshooting

- **`validate` job fails on `docker compose config`**: same as
  staging — a YAML/variable-substitution mistake in
  `docker-compose.production.yml`, nothing host-specific.
- **`production-deploy.sh` exits before pulling anything, complaining
  IMAGE_TAG is required**: expected — production has no `latest`
  default on purpose. Pass an explicit tag, or `rollback: true`.
- **Health check never passes for the new color**: check
  `docker compose -f docker-compose.production.yml logs backend-blue`
  (or `backend-green`, whichever was the target) on the host directly.
  The currently-active color is unaffected either way, so there's no
  urgency to "fix production" — the site is still up on the old color.
- **`nginx -s reload` fails**: the target color passed its own health
  check but nginx itself has a problem (e.g. `nginx/conf.d/active.conf`
  wasn't writable, or the `rox-nginx-production` container isn't
  running). Check `docker logs rox-nginx-production` on the host — the
  previously-active color is still serving traffic throughout.
- **A rollback (`rollback: true`) fails with "not healthy — refusing
  to cut traffic"**: the inactive color genuinely isn't in a good
  state (maybe it was never successfully deployed, or was itself the
  target of a failed deploy attempt). There's no automatic recovery
  from this — deploy a known-good tag explicitly instead of rolling
  back to something that was never actually verified.
