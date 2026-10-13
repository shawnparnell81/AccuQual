# ---- Stage 1: install deps ----
FROM node:26-alpine AS deps
WORKDIR /repo
COPY package.json ./
COPY services/api/package.json services/api/package.json
RUN npm install --workspace services/api --include-workspace-root

# ---- Stage 1b: production-only dependencies ----
# What the RUNNING container needs. The full install above (compilers, the test runner, the dev server) is only for
# the build stage; shipping it made the image larger and dragged known-vulnerable dev tooling into production.
FROM node:26-alpine AS proddeps
WORKDIR /repo
COPY package.json ./
COPY services/api/package.json services/api/package.json
RUN npm install --workspace services/api --include-workspace-root --omit=dev

# ---- Stage 2: build TypeScript ----
FROM node:26-alpine AS build
WORKDIR /repo
# Only the root node_modules is copied — with just this one workspace's
# package.json present (no other workspace visible), npm workspaces hoists
# everything here rather than nesting a services/api/node_modules, so that
# path never exists; copying it used to fail the build outright.
COPY --from=deps /repo/node_modules ./node_modules
# `npm run --workspace` needs the root package.json present to resolve which
# directory that workspace name maps to — a second, previously-masked bug
# (the build never got this far before the node_modules COPY above was fixed).
COPY package.json ./
COPY tsconfig.base.json ./
COPY services/api ./services/api
RUN npm run build --workspace services/api

# ---- Stage 3: run lightweight Node.js server ----
FROM node:26-alpine AS runtime
# Pick up OS security patches released since the base image was built, and drop npm/yarn: nothing runs a package
# manager in production, and npm's own bundled libraries were a source of scanner findings.
RUN apk upgrade --no-cache && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
# ClamAV scans every uploaded file. docker/entrypoint.sh runs freshclam (definitions update on start and every 6 hours)
# and clamd beside the API, and waits for clamd before starting it. clamd keeps its signatures in memory, so the
# service needs about 2 GB of RAM (see docs/virus-scanning.md). A baseline set of definitions is baked into the image
# so the first start is quick; the build still passes if the ClamAV mirror cannot be reached.
RUN apk add --no-cache clamav clamav-daemon freshclam \
 && printf 'DatabaseDirectory /var/lib/clamav\nDatabaseMirror database.clamav.net\nDatabaseOwner clamav\n' > /tmp/freshclam-build.conf \
 && (freshclam --config-file=/tmp/freshclam-build.conf || echo "Could not fetch baseline virus definitions at build time; freshclam will fetch them at start.") \
 && rm -f /tmp/freshclam-build.conf
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/services/api/docker/entrypoint.sh /usr/local/bin/api-entrypoint.sh
# Strip any Windows line endings and make it runnable regardless of how git checked it out.
RUN sed -i 's/\r$//' /usr/local/bin/api-entrypoint.sh && chmod +x /usr/local/bin/api-entrypoint.sh
COPY --from=build /repo/services/api/dist ./dist
COPY --from=build /repo/services/api/assets ./assets
COPY --from=build /repo/services/api/package.json ./package.json
# The hoisted root node_modules, not a per-workspace one (see the build stage's
# comment) — placed at /app/node_modules so Node's upward module resolution
# finds it from dist/index.js regardless of how deep dist's own layout is.
COPY --from=proddeps /repo/node_modules ./node_modules
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/api-entrypoint.sh"]
CMD ["node", "dist/index.js"]
