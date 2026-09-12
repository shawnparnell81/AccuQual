# ---- Stage 1: install deps ----
FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json ./
COPY workers/ai-worker/package.json workers/ai-worker/package.json
RUN npm install --workspace workers/ai-worker --include-workspace-root

# ---- Stage 2: build TypeScript ----
FROM node:20-alpine AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/workers/ai-worker/node_modules ./workers/ai-worker/node_modules
COPY tsconfig.base.json ./
COPY workers/ai-worker ./workers/ai-worker
COPY services/api/src/drizzle ./services/api/src/drizzle
COPY services/api/src/modules/ai ./services/api/src/modules/ai
COPY services/api/src/config ./services/api/src/config
COPY services/api/src/utils ./services/api/src/utils
RUN npm run build --workspace workers/ai-worker

# ---- Stage 3: run ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/workers/ai-worker/dist ./dist
COPY --from=build /repo/workers/ai-worker/package.json ./package.json
COPY --from=deps /repo/workers/ai-worker/node_modules ./node_modules
CMD ["node", "dist/workers/ai-worker/src/index.js"]
