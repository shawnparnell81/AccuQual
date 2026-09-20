# ---- Stage 1: install deps ----
FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json ./
COPY workers/digital-twin-worker/package.json workers/digital-twin-worker/package.json
RUN npm install --workspace workers/digital-twin-worker --include-workspace-root

# ---- Stage 1b: production-only dependencies ----
# What the RUNNING container needs. The full install above (compilers, the test runner, the dev server) is only for
# the build stage; shipping it made the image larger and dragged known-vulnerable dev tooling into production.
FROM node:20-alpine AS proddeps
WORKDIR /repo
COPY package.json ./
COPY workers/digital-twin-worker/package.json workers/digital-twin-worker/package.json
RUN npm install --workspace workers/digital-twin-worker --include-workspace-root --omit=dev

# ---- Stage 2: build TypeScript ----
FROM node:20-alpine AS build
WORKDIR /repo
# Only the root node_modules is copied — with just this one workspace's
# package.json present (no other workspace visible), npm workspaces hoists
# everything here rather than nesting a per-workspace node_modules, so that
# path never exists; copying it used to fail the build outright.
COPY --from=deps /repo/node_modules ./node_modules
# `npm run --workspace` needs the root package.json present to resolve which
# directory that workspace name maps to — a second, previously-masked bug
# (the build never got this far before the node_modules COPY above was fixed).
COPY package.json ./
COPY tsconfig.base.json ./
COPY workers/digital-twin-worker ./workers/digital-twin-worker
# services/api's own package.json (declares "type": "module") must be present
# so TypeScript's nearest-ancestor lookup for the copied services/api/src
# files resolves it instead of falling through to the root package.json
# (which has no "type", so defaults to CommonJS) — that mismatch made
# TypeScript instantiate drizzle-orm's types twice (once per module format)
# and fail with spurious "private property" incompatibility errors.
COPY services/api/package.json ./services/api/package.json
# services/api/src/utils/logger.ts (and the auth/tenant-scope helpers) read the per-request context from this one file.
COPY services/api/src/modules/monitoring/requestContext.ts ./services/api/src/modules/monitoring/requestContext.ts
COPY services/api/src/drizzle ./services/api/src/drizzle
COPY services/api/src/modules/digital-twin ./services/api/src/modules/digital-twin
RUN npm run build --workspace workers/digital-twin-worker

# ---- Stage 3: run ----
FROM node:20-alpine AS runtime
# Pick up OS security patches released since the base image was built, and drop npm/yarn: nothing runs a package
# manager in production, and npm's own bundled libraries were a source of scanner findings.
RUN apk upgrade --no-cache && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/workers/digital-twin-worker/dist ./dist
COPY --from=build /repo/workers/digital-twin-worker/package.json ./package.json
# The hoisted root node_modules, not a per-workspace one (see the build stage's
# comment) — placed at /app/node_modules so Node's upward module resolution
# finds it regardless of how deep dist's own layout is.
COPY --from=proddeps /repo/node_modules ./node_modules
CMD ["node", "dist/workers/digital-twin-worker/src/index.js"]
