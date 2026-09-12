# ---- Stage 1: install deps ----
FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json ./
COPY services/api/package.json services/api/package.json
RUN npm install --workspace services/api --include-workspace-root

# ---- Stage 2: build TypeScript ----
FROM node:20-alpine AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/services/api/node_modules ./services/api/node_modules
COPY tsconfig.base.json ./
COPY services/api ./services/api
RUN npm run build --workspace services/api

# ---- Stage 3: run lightweight Node.js server ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/services/api/dist ./dist
COPY --from=build /repo/services/api/package.json ./package.json
COPY --from=deps /repo/services/api/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/index.js"]
