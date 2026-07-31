#!/usr/bin/env bash
# ROX AI — production-deploy.sh
#
# Runs ON THE PRODUCTION HOST ITSELF, invoked over SSH by
# .github/workflows/deploy-production.yml. Same delivery mechanism as
# scripts/deploy/staging-deploy.sh (copied into the deploy directory
# by the workflow before this runs), different cutover strategy: this
# one is blue/green instead of in-place, because an in-place restart
# on production means a real window of dropped requests, not just a
# staging inconvenience.
#
# Model: backend-blue and backend-green (docker-compose.production.yml)
# are BOTH always running. Exactly one is "active" — nginx routes real
# traffic to it (nginx/active.conf.template, rendered to
# nginx/conf.d/active.conf). A deploy:
#   1. pulls the target tag for backend + worker,
#   2. starts/recreates ONLY the INACTIVE color with the new image,
#   3. health-checks that inactive color directly on its own host port
#      (3011 for blue, 3012 for green — see docker-compose.production.yml)
#      — nginx and the currently-active color are untouched during
#      this step, so a failed deploy has zero production impact,
#   4. only on a passing health check: renders the nginx template
#      pointing at the now-verified color and reloads nginx (graceful —
#      existing connections finish against the old color, new
#      connections get the new one immediately),
#   5. updates worker in place (brief restart — acceptable; BullMQ job
#      state lives in Redis, not in the worker process, see
#      docs/DEPLOYMENT.md).
# The OLD color is left running, not stopped — that is what makes
# ROLLBACK=true instant: flip nginx back to it, no pull, no restart,
# no health-check wait (it's already known-good, it was serving
# traffic seconds ago).
#
# Required environment variables (set by deploy-production.yml):
#   REGISTRY      e.g. ghcr.io
#   OWNER_REPO    e.g. your-org/rox-ai (lowercase)
#   IMAGE_TAG     the tag to deploy, e.g. sha-abc12345 or v1.2.0 —
#                 deliberately NO default here (unlike staging's
#                 `latest` default): production should never deploy a
#                 tag nobody explicitly named. Required unless
#                 ROLLBACK=true.
#   GHCR_ACTOR    GitHub username/actor for `docker login`
#   GHCR_TOKEN    token for `docker login` (the workflow's GITHUB_TOKEN
#                 is sufficient — read:packages scope, job-lifetime only)
# Optional:
#   ROLLBACK      "true" to flip nginx back to whichever color is
#                 currently inactive, without pulling or restarting
#                 anything (default: "false"). Fails loudly if the
#                 inactive color isn't actually running/healthy.
#   PORT          public port nginx listens on (default: 3001)
#   HEALTH_RETRIES / HEALTH_INTERVAL_SECONDS  (defaults: 15 / 3 — a
#                 little more patient than staging's defaults, since a
#                 failed production health check costs nothing here
#                 (traffic never moved) so there's no reason to be
#                 impatient about it)
#   DRAIN_SECONDS grace period after a cutover before this script exits
#                 (default: 5) — purely a courtesy pause so the job
#                 summary doesn't report success before nginx's reload
#                 has had a moment to settle; does not stop or affect
#                 the old color, which keeps running regardless.
#
# State kept in this directory between runs:
#   .active-color   "blue" or "green" — whichever color nginx is
#                   currently pointed at. Absent on a fresh host,
#                   defaulting to "blue" as the first-ever active color.
#
# Exit code is what the GitHub Actions job's success/failure is judged
# on — 0 only when the target color ends up running, healthy, and
# (for a normal deploy) actually receiving traffic via nginx.

set -uo pipefail

REGISTRY="${REGISTRY:?REGISTRY is required}"
OWNER_REPO="${OWNER_REPO:?OWNER_REPO is required}"
GHCR_ACTOR="${GHCR_ACTOR:?GHCR_ACTOR is required}"
GHCR_TOKEN="${GHCR_TOKEN:?GHCR_TOKEN is required}"
ROLLBACK="${ROLLBACK:-false}"
PORT="${PORT:-3001}"
HEALTH_RETRIES="${HEALTH_RETRIES:-15}"
HEALTH_INTERVAL_SECONDS="${HEALTH_INTERVAL_SECONDS:-3}"
DRAIN_SECONDS="${DRAIN_SECONDS:-5}"

if [ "$ROLLBACK" != "true" ]; then
  IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required for a non-rollback deploy — production never defaults to a mutable tag}"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="docker-compose.production.yml"
ACTIVE_COLOR_FILE=".active-color"
NGINX_TEMPLATE="nginx/active.conf.template"
NGINX_RENDERED="nginx/conf.d/active.conf"
NGINX_CONTAINER="rox-nginx-production"

log() { echo "[production-deploy] $*"; }

other_color() {
  if [ "$1" = "blue" ]; then echo "green"; else echo "blue"; fi
}

color_port() {
  if [ "$1" = "blue" ]; then echo "3011"; else echo "3012"; fi
}

color_upstream() {
  if [ "$1" = "blue" ]; then echo "backend-blue:3001"; else echo "backend-green:3001"; fi
}

# health_check_color: polls a color's dedicated host port directly
# (bypassing nginx entirely) so this reflects that specific
# container's health, not whatever nginx currently happens to route.
health_check_color() {
  local color="$1"
  local port
  port="$(color_port "$color")"
  log "Waiting for backend-$color /healthz on port $port (up to $((HEALTH_RETRIES * HEALTH_INTERVAL_SECONDS))s)..."
  local attempt=1
  while [ "$attempt" -le "$HEALTH_RETRIES" ]; do
    if curl -fsS "http://localhost:${port}/healthz" >/dev/null 2>&1; then
      log "backend-$color healthy after $attempt attempt(s)."
      return 0
    fi
    sleep "$HEALTH_INTERVAL_SECONDS"
    attempt=$((attempt + 1))
  done
  log "backend-$color never became healthy. Recent logs:"
  docker compose -f "$COMPOSE_FILE" logs --tail=100 "backend-$color"
  return 1
}

# cut_over_to: renders nginx/conf.d/active.conf pointing at $1's
# upstream and gracefully reloads nginx. This is the only step that
# actually changes what receives production traffic.
cut_over_to() {
  local color="$1"
  local upstream
  upstream="$(color_upstream "$color")"
  log "Cutting traffic over to backend-$color ($upstream)..."
  sed "s/__ACTIVE_UPSTREAM__/${upstream}/" "$NGINX_TEMPLATE" >"$NGINX_RENDERED"
  if ! docker exec "$NGINX_CONTAINER" nginx -s reload; then
    log "nginx reload failed — active.conf was rewritten but nginx did not pick it up. Manual check required on the host."
    return 1
  fi
  echo "$color" >"$ACTIVE_COLOR_FILE"
  log "Cutover complete. Active color is now: $color"
  return 0
}

mkdir -p nginx/conf.d

docker login "$REGISTRY" -u "$GHCR_ACTOR" --password-stdin <<<"$GHCR_TOKEN" || {
  log "docker login to $REGISTRY failed — aborting, no containers touched."
  exit 1
}

current_active="$(cat "$ACTIVE_COLOR_FILE" 2>/dev/null || echo blue)"
log "Current active color: $current_active"

if [ "$ROLLBACK" = "true" ]; then
  rollback_target="$(other_color "$current_active")"
  log "Rollback requested — flipping back to $rollback_target (no pull, no restart: it should already be running)."
  if ! health_check_color "$rollback_target"; then
    log "Rollback target backend-$rollback_target is not healthy — refusing to cut traffic to it. Nothing changed; $current_active is still active."
    exit 1
  fi
  if cut_over_to "$rollback_target"; then
    sleep "$DRAIN_SECONDS"
    log "Rollback complete. Now active: $rollback_target"
    exit 0
  fi
  exit 1
fi

target_color="$(other_color "$current_active")"
log "Deploying tag $IMAGE_TAG to inactive color: $target_color (active color $current_active is untouched throughout this step)"

if ! docker pull "$REGISTRY/$OWNER_REPO/backend:$IMAGE_TAG"; then
  log "Pull failed for backend:$IMAGE_TAG — nothing running was touched."
  exit 1
fi
if ! docker pull "$REGISTRY/$OWNER_REPO/worker:$IMAGE_TAG"; then
  log "Pull failed for worker:$IMAGE_TAG — nothing running was touched."
  exit 1
fi

REGISTRY="$REGISTRY" OWNER_REPO="$OWNER_REPO" IMAGE_TAG="$IMAGE_TAG" PORT="$PORT" \
  docker compose -f "$COMPOSE_FILE" up -d --no-deps "backend-$target_color"

if ! health_check_color "$target_color"; then
  log "Deploy of $IMAGE_TAG to backend-$target_color failed health checks. Active color is still $current_active — production traffic was never affected. backend-$target_color is left running in its failed state for inspection; it will simply be overwritten by the next deploy attempt."
  exit 1
fi

if ! cut_over_to "$target_color"; then
  log "backend-$target_color was healthy but the nginx cutover itself failed. Active color is still $current_active — check nginx on the host manually before retrying."
  exit 1
fi

sleep "$DRAIN_SECONDS"

log "Updating worker to $IMAGE_TAG (brief restart — job state lives in Redis, not in this process)..."
REGISTRY="$REGISTRY" OWNER_REPO="$OWNER_REPO" IMAGE_TAG="$IMAGE_TAG" \
  docker compose -f "$COMPOSE_FILE" up -d --no-deps worker

log "Deploy complete. Now active: $target_color (tag $IMAGE_TAG). Previous color $current_active is still running for instant rollback."
exit 0
