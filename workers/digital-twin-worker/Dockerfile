# ---- Stage 1: install deps ----
FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json ./
COPY workers/digital-twin-worker/package.json workers/digital-twin-worker/package.json
RUN npm install --workspace workers/digital-twin-worker --include-workspace-root

# ---- Stage 2: build TypeScript ----
FROM node:20-alpine AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/workers/digital-twin-worker/node_modules ./workers/digital-twin-worker/node_modules
COPY tsconfig.base.json ./
COPY workers/digital-twin-worker ./workers/digital-twin-worker
COPY services/api/src/drizzle ./services/api/src/drizzle
COPY services/api/src/modules/digital-twin ./services/api/src/modules/digital-twin
RUN npm run build --workspace workers/digital-twin-worker

# ---- Stage 3: run ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/workers/digital-twin-worker/dist ./dist
COPY --from=build /repo/workers/digital-twin-worker/package.json ./package.json
COPY --from=deps /repo/workers/digital-twin-worker/node_modules ./node_modules
CMD ["node", "dist/workers/digital-twin-worker/src/index.js"]
