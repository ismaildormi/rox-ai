# ROX AI â€” backend API server (production image)
#
# Multi-stage build: a `deps` stage installs ONLY production
# dependencies (--omit=dev; there's no devDependencies block in
# package.json today, but this keeps the image correct if one is ever
# added) so they never end up in the final image, then the `runtime`
# stage copies just node_modules + app source on top of a fresh, slim
# base â€” smaller image, smaller attack surface, no build toolchain left
# behind. Uses `npm install` rather than `npm ci`: this repo has no
# package-lock.json yet (see Phase 1's security-review notes), and
# `npm ci` requires one â€” switch to `npm ci` once a lockfile is
# committed, for fully reproducible installs.
#
# This image runs `node server.js` directly â€” NOT through pm2
# (ecosystem.config.js / `./cli/rox.js start` is the bare-metal path;
# see ARCHITECTURE.md Â§13 "Deployment: two independent paths"). Docker/the orchestrator
# (docker-compose's `restart:`, or Kubernetes/Railway/Render's own
# supervisor) already does what pm2's autorestart does â€” running pm2
# *inside* a container on top of that is a well-known anti-pattern: it
# double-supervises, and pm2 doesn't forward SIGTERM to the child the
# way a container runtime expects, which delays/breaks graceful
# shutdown. Nothing about the existing CLI/pm2 flow changes â€” this is
# an additional deployment path, not a replacement.
#
# Build (from the backend/ directory, or with `-f backend/Dockerfile .`
# and matching context â€” see docker-compose.yml at the repo root):
#   docker build -t rox-ai-backend .
# Run:
#   docker run --env-file .env -p 3001:3001 rox-ai-backend

# ---- deps stage --------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# package.json + package-lock.json (if present) copied separately from
# the rest of the source so this layer is only invalidated when
# dependencies actually change, not on every source edit.
COPY package.json ./
COPY package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# ---- runtime stage ------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

# Alpine's default is already close to minimal; tini gives correct PID 1
# signal handling (SIGTERM reaches node, zombie reaping for anything
# child_process spawns â€” e.g. diskMonitor's docker/df calls) without
# writing a custom entrypoint script.
RUN apk add --no-cache tini

ENV NODE_ENV=production

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

# Run as a non-root user â€” the image ships with a `node` user already
# (official Node image convention); nothing here needs root.
USER node

EXPOSE 3001

# healthz is unauthenticated by design (see server.js) â€” exactly what an
# orchestrator's own health probe needs to hit without a token.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
