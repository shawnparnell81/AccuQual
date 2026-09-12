# ---- Stage 1: install deps ----
FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json ./
COPY workers/ai-worker/package.json workers/ai-worker/package.json
RUN npm install --workspace workers/ai-worker --include-workspace-root

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
COPY workers/ai-worker ./workers/ai-worker
# services/api's own package.json (declares "type": "module") must be present
# so TypeScript's nearest-ancestor lookup for the copied services/api/src
# files resolves it instead of falling through to the root package.json
# (which has no "type", so defaults to CommonJS) — that mismatch made
# TypeScript instantiate drizzle-orm's types twice (once per module format)
# and fail with spurious "private property" incompatibility errors.
COPY services/api/package.json ./services/api/package.json
COPY services/api/src/drizzle ./services/api/src/drizzle
COPY services/api/src/modules/ai ./services/api/src/modules/ai
COPY services/api/src/config ./services/api/src/config
COPY services/api/src/utils ./services/api/src/utils
# embedding-engine.ts imports the `TenantDb` *type* from lib/tenantScope.ts —
# by design (see that file's own comment), so tsc must still fully resolve
# tenantScope.ts's real imports (db/index.ts, middleware/auth.ts, and
# transitively express/jsonwebtoken/zod, added to this package's own
# package.json) even though none of them run at this worker's runtime.
COPY services/api/src/lib ./services/api/src/lib
COPY services/api/src/db ./services/api/src/db
COPY services/api/src/middleware ./services/api/src/middleware
RUN npm run build --workspace workers/ai-worker

# ---- Stage 3: run ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/workers/ai-worker/dist ./dist
COPY --from=build /repo/workers/ai-worker/package.json ./package.json
# The hoisted root node_modules, not a per-workspace one (see the build stage's
# comment) — placed at /app/node_modules so Node's upward module resolution
# finds it regardless of how deep dist's own layout is.
COPY --from=deps /repo/node_modules ./node_modules
CMD ["node", "dist/workers/ai-worker/src/index.js"]
