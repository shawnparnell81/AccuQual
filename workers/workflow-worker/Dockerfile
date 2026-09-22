# ---- Stage 1: install deps ----
FROM node:26-alpine AS deps
WORKDIR /repo
COPY package.json ./
COPY workers/workflow-worker/package.json workers/workflow-worker/package.json
RUN npm install --workspace workers/workflow-worker --include-workspace-root

# ---- Stage 1b: production-only dependencies ----
# What the RUNNING container needs. The full install above (compilers, the test runner, the dev server) is only for
# the build stage; shipping it made the image larger and dragged known-vulnerable dev tooling into production.
FROM node:26-alpine AS proddeps
WORKDIR /repo
COPY package.json ./
COPY workers/workflow-worker/package.json workers/workflow-worker/package.json
RUN npm install --workspace workers/workflow-worker --include-workspace-root --omit=dev

# ---- Stage 2: build TypeScript ----
FROM node:26-alpine AS build
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
COPY workers/workflow-worker ./workers/workflow-worker
# services/api's own package.json (declares "type": "module") must be present
# so TypeScript's nearest-ancestor lookup for the copied services/api/src
# files resolves it instead of falling through to the root package.json
# (which has no "type", so defaults to CommonJS) — that mismatch made
# TypeScript instantiate drizzle-orm's types twice (once per module format)
# and fail with spurious "private property" incompatibility errors.
# The FULL services/api/src tree, not a hand-picked subset — workflowActions.ts
# registers action handlers spanning nearly every module (create_ncr,
# escalate_capa, notify_department, send_email, ai_suggestion, ...), so it
# transitively imports far more of services/api than just modules/workflow
# (lib/tenantScope.ts, middleware/departmentAccess.ts, modules/notifications,
# modules/audit-trail, modules/ai, ...). A narrower whitelist here silently
# broke this exact build the first time a new import was added to that file
# (see git history) with zero warning from CI, since CI's own "Build Workers"
# step runs tsc directly against the full checkout, never through this
# Dockerfile's isolated COPY — only `docker compose build`/a real Render
# deploy ever exercised this path. Cheap to copy in full: this is the BUILD
# stage only, source files, not the final runtime image (see Stage 3 below,
# which copies only this worker's own compiled dist/ output).
COPY services/api/package.json ./services/api/package.json
COPY services/api/src ./services/api/src
RUN npm run build --workspace workers/workflow-worker

# ---- Stage 3: run ----
FROM node:26-alpine AS runtime
# Pick up OS security patches released since the base image was built, and drop npm/yarn: nothing runs a package
# manager in production, and npm's own bundled libraries were a source of scanner findings.
RUN apk upgrade --no-cache && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/workers/workflow-worker/dist ./dist
COPY --from=build /repo/workers/workflow-worker/package.json ./package.json
# The hoisted root node_modules, not a per-workspace one (see the build stage's
# comment) — placed at /app/node_modules so Node's upward module resolution
# finds it regardless of how deep dist's own layout is.
COPY --from=proddeps /repo/node_modules ./node_modules
CMD ["node", "dist/workers/workflow-worker/src/index.js"]
