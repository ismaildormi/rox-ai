#!/usr/bin/env bash
# ROX AI — staging-deploy.sh
#
# Runs ON THE STAGING HOST ITSELF, invoked over SSH by
# .github/workflows/deploy-staging.yml. Not meant to be run from a
# developer laptop against production, and not meant to be run
# unattended against anything other than the compose file it ships
# next to (docker-compose.staging.yml, copied into the same directory
# by the workflow before this script runs).
#
# What it does, in order:
#   1. docker login to GHCR (credentials passed in as env vars, never
#      written to disk).
#   2. Pull the target image tag for both backend and worker. A pull
#      failure stops here — never touches the currently running
#      containers.
#   3. docker compose up -d with that tag.
#   4. Poll /healthz on the API container until it reports 200, or
#      give up after a fixed number of retries.
#   5a. On success: record the new tag as "current" (rotating the old
#       "current" into "previous") so a future rollback knows what to
#       go back to.
#   5b. On failure: print the last container logs for diagnosis, then
#       — unless this run WAS already a rollback attempt — automatically
#       redeploy the last known-good tag (step 1-4 again) instead of
#       leaving staging on a broken build.
#
# Required environment variables (set by deploy-staging.yml):
#   REGISTRY      e.g. ghcr.io
#   OWNER_REPO    e.g. your-org/rox-ai (lowercase)
#   IMAGE_TAG     the tag to deploy, e.g. sha-abc12345 or latest
#   GHCR_ACTOR    GitHub username/actor for `docker login`
#   GHCR_TOKEN    token for `docker login` (the workflow's GITHUB_TOKEN
#                 is sufficient — read:packages scope, job-lifetime only)
# Optional:
#   ROLLBACK      "true" to ignore IMAGE_TAG and redeploy the tag
#                 recorded as "previous" instead (default: "false")
#   PORT          port /healthz is reachable on locally (default: 3001)
#   HEALTH_RETRIES / HEALTH_INTERVAL_SECONDS  (defaults: 10 / 3)
#
# State kept in this directory between runs:
#   .current-tag   the tag currently running (written after a
#                  successful health check)
#   .previous-tag  the tag that was running before that — what a
#                  rollback deploys
#
# Exit code is what the GitHub Actions job's success/failure is judged
# on — 0 only when the target ends up running and healthy (whether
# that's the originally requested tag or, after an auto-rollback, the
# previous one).

set -uo pipefail

REGISTRY="${REGISTRY:?REGISTRY is required}"
OWNER_REPO="${OWNER_REPO:?OWNER_REPO is required}"
GHCR_ACTOR="${GHCR_ACTOR:?GHCR_ACTOR is required}"
GHCR_TOKEN="${GHCR_TOKEN:?GHCR_TOKEN is required}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
ROLLBACK="${ROLLBACK:-false}"
PORT="${PORT:-3001}"
HEALTH_RETRIES="${HEALTH_RETRIES:-10}"
HEALTH_INTERVAL_SECONDS="${HEALTH_INTERVAL_SECONDS:-3}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="docker-compose.staging.yml"
CURRENT_TAG_FILE=".current-tag"
PREVIOUS_TAG_FILE=".previous-tag"

log() { echo "[staging-deploy] $*"; }

docker login "$REGISTRY" -u "$GHCR_ACTOR" --password-stdin <<<"$GHCR_TOKEN" || {
  log "docker login to $REGISTRY failed — aborting, no containers touched."
  exit 1
}

# deploy_tag: pull + compose up + health-check a given tag.
# Returns 0 on a healthy deploy, 1 otherwise. Never exits the script
# directly so the caller can decide whether to attempt a rollback.
deploy_tag() {
  local tag="$1"
  log "Deploying tag: $tag"

  if ! docker pull "$REGISTRY/$OWNER_REPO/backend:$tag"; then
    log "Pull failed for backend:$tag — currently running containers left untouched."
    return 1
  fi
  if ! docker pull "$REGISTRY/$OWNER_REPO/worker:$tag"; then
    log "Pull failed for worker:$tag — currently running containers left untouched."
    return 1
  fi

  REGISTRY="$REGISTRY" OWNER_REPO="$OWNER_REPO" IMAGE_TAG="$tag" PORT="$PORT" \
    docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

  log "Waiting for /healthz (up to $((HEALTH_RETRIES * HEALTH_INTERVAL_SECONDS))s)..."
  local attempt=1
  while [ "$attempt" -le "$HEALTH_RETRIES" ]; do
    if curl -fsS "http://localhost:${PORT}/healthz" >/dev/null 2>&1; then
      log "Healthy after $attempt attempt(s)."
      return 0
    fi
    sleep "$HEALTH_INTERVAL_SECONDS"
    attempt=$((attempt + 1))
  done

  log "Health check never passed for tag $tag. Recent container logs:"
  REGISTRY="$REGISTRY" OWNER_REPO="$OWNER_REPO" IMAGE_TAG="$tag" \
    docker compose -f "$COMPOSE_FILE" logs --tail=100
  return 1
}

if [ "$ROLLBACK" = "true" ]; then
  if [ ! -f "$PREVIOUS_TAG_FILE" ]; then
    log "ROLLBACK requested but no $PREVIOUS_TAG_FILE exists yet (no prior successful deploy on record) — nothing to roll back to."
    exit 1
  fi
  target_tag="$(cat "$PREVIOUS_TAG_FILE")"
  log "Rollback requested — redeploying previous known-good tag: $target_tag"
  if deploy_tag "$target_tag"; then
    echo "$target_tag" >"$CURRENT_TAG_FILE"
    log "Rollback complete. Now running: $target_tag"
    exit 0
  else
    log "Rollback deploy of $target_tag also failed health checks. Manual intervention required."
    exit 1
  fi
fi

if deploy_tag "$IMAGE_TAG"; then
  if [ -f "$CURRENT_TAG_FILE" ]; then
    cp "$CURRENT_TAG_FILE" "$PREVIOUS_TAG_FILE"
  fi
  echo "$IMAGE_TAG" >"$CURRENT_TAG_FILE"
  log "Deploy complete. Now running: $IMAGE_TAG"
  exit 0
fi

log "Deploy of $IMAGE_TAG failed health checks."

if [ -f "$PREVIOUS_TAG_FILE" ]; then
  fallback_tag="$(cat "$PREVIOUS_TAG_FILE")"
  log "Attempting automatic rollback to last known-good tag: $fallback_tag"
  if deploy_tag "$fallback_tag"; then
    echo "$fallback_tag" >"$CURRENT_TAG_FILE"
    log "Automatic rollback succeeded. Now running: $fallback_tag (deploy of $IMAGE_TAG is still considered FAILED)."
    exit 1
  else
    log "Automatic rollback to $fallback_tag ALSO failed health checks. Staging may be down — manual intervention required."
    exit 1
  fi
else
  log "No previous known-good tag on record — nothing to automatically roll back to. Staging may be down — manual intervention required."
  exit 1
fi
