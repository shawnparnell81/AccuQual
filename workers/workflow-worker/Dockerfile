# ---- Stage 1: install deps ----
FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json ./
COPY workers/workflow-worker/package.json workers/workflow-worker/package.json
RUN npm install --workspace workers/workflow-worker --include-workspace-root

# ---- Stage 2: build TypeScript ----
FROM node:20-alpine AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/workers/workflow-worker/node_modules ./workers/workflow-worker/node_modules
COPY tsconfig.base.json ./
COPY workers/workflow-worker ./workers/workflow-worker
COPY services/api/src/drizzle ./services/api/src/drizzle
COPY services/api/src/modules/workflow ./services/api/src/modules/workflow
RUN npm run build --workspace workers/workflow-worker

# ---- Stage 3: run ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/workers/workflow-worker/dist ./dist
COPY --from=build /repo/workers/workflow-worker/package.json ./package.json
COPY --from=deps /repo/workers/workflow-worker/node_modules ./node_modules
CMD ["node", "dist/workers/workflow-worker/src/index.js"]
